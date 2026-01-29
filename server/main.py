import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from typing import List

# Configure Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("WebRTC-Server")

app = FastAPI()

# 1. CORS Middleware (Allows phone to talk to laptop)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2. Static File Serving
app.mount("/client", StaticFiles(directory="client", html=True), name="client")
app.mount("/viewer", StaticFiles(directory="viewer", html=True), name="viewer")

# 3. Connection Manager
class ConnectionManager:
    def __init__(self):
        # We store connections as a list. In a real app, use a dictionary {id: websocket}
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"New connection. Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"Disconnected. Remaining: {len(self.active_connections)}")

    async def broadcast(self, message: str, sender: WebSocket):
        # Send the message to everyone EXCEPT the sender
        for connection in self.active_connections:
            if connection != sender:
                try:
                    await connection.send_text(message)
                except Exception as e:
                    logger.error(f"Error sending message: {e}")

manager = ConnectionManager()

# 4. WebSocket Endpoint
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Relay signaling data (SDP/ICE) to the other peer
            await manager.broadcast(data, websocket)
    except WebSocketDisconnect:
        manager.disconnect(websocket)