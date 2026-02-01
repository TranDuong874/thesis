from fastapi import FastAPI, WebSocket
from fastapi.responses import HTMLResponse
from aiortc import RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, MediaStreamTrack
import json
from av import VideoFrame

app = FastAPI()

@app.get('/')
def index():
    return {"message" : "health check"}

class VideoProcessorTrack(MediaStreamTrack):
    kind = "video"

    def __init__(self, track):
        super().__init__() 
        self.track = track

    async def recv(self):
        # 1. Receive the raw frame from the client
        frame = await self.track.recv()

        # 2. Convert to NumPy for OpenCV processing
        img = frame.to_ndarray(format="bgr24")

        # --- START YOUR AI/CV PROCESSING ---
        # Example: Grayscale filter (Replace with your 3D/ML logic)
        import cv2
        processed_img = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        processed_img = cv2.cvtColor(processed_img, cv2.COLOR_GRAY2BGR)
        # --- END YOUR AI/CV PROCESSING ---

        # 3. Convert back to a WebRTC frame
        new_frame = VideoFrame.from_ndarray(processed_img, format="bgr24")
        new_frame.pts = frame.pts
        new_frame.time_base = frame.time_base
        cv2.imshow("Server Preview", processed_img) 
        cv2.waitKey(1) # Necessary for the window to refresh
        return new_frame

@app.websocket('/ws/signaling_handler')
async def signaling_handler(websocket: WebSocket):
    await websocket.accept()
    peer_connection = RTCPeerConnection()

    # @peer_connection.on("datachannel") # datachannel is server's default event wraps custom events
    # def on_datachannel(channel):
    #     # Define custom event listeners here
    #     @channel.on("video") # custom defined events
    #     def handle(video):
    #         pass
    # Inside your signaling_handler:
    @peer_connection.on("track")
    def on_track(track):
        if track.kind == "video":
            # Create the processor and add it to the connection to send it BACK to client
            local_video = VideoProcessorTrack(track)
            peer_connection.addTrack(local_video)
            
    @peer_connection.on("connectionstatechange")
    async def on_connectionstatechange():
        print(f"Connection state: {peer_connection.connectionState}")
    # Signaling
    try:
        while True:
            message = await websocket.receive_text()
            data = json.loads(message)
            msg_type = data.get("type")
            if msg_type == "offer": # "type" belongs to websocket, channel is decided by rtc
                offer = RTCSessionDescription(sdp=data["sdp"], type=data["type"])
                await peer_connection.setRemoteDescription(offer)

                answer = await peer_connection.createAnswer()
                await peer_connection.setLocalDescription(answer)

                await websocket.send_text(json.dumps({
                    "type": peer_connection.localDescription.type,
                    "sdp": peer_connection.localDescription.sdp
                }))

    except Exception as e:
        print(f"Connection closed or error: {e}")
    finally:
        await peer_connection.close()
