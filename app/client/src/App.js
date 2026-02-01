import { useEffect, useRef, useState } from 'react';

export default function VideoProcessor() {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const [status, setStatus] = useState('disconnected');
  const [error, setError] = useState('');
  const [facingMode, setFacingMode] = useState('user');
  const [quality, setQuality] = useState('medium'); // low, medium, high
  
  const pcRef = useRef(null);
  const wsRef = useRef(null);
  const streamRef = useRef(null);

  // Quality presets
  const qualitySettings = {
    low: {
      width: 320,
      height: 240,
      frameRate: 15,
      bitrate: 200000 // 200 kbps
    },
    medium: {
      width: 640,
      height: 480,
      frameRate: 24,
      bitrate: 500000 // 500 kbps
    },
    high: {
      width: 1280,
      height: 720,
      frameRate: 30,
      bitrate: 1500000 // 1.5 Mbps
    },
    ultra: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      bitrate: 3000000 // 3 Mbps
    }
  };

  const start = async () => {
    try {
      setStatus('connecting');
      setError('');

      const settings = qualitySettings[quality];

      // Get camera with quality constraints
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facingMode,
          width: { ideal: settings.width },
          height: { ideal: settings.height },
          frameRate: { ideal: settings.frameRate }
        },
        audio: false
      });
      streamRef.current = stream;
      localVideoRef.current.srcObject = stream;

      // Connect WebSocket
      const ws = new WebSocket('ws://192.168.1.14:8000/ws/signaling_handler');
      wsRef.current = ws;

      ws.onopen = async () => {
        const pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        pcRef.current = pc;

        // Add track with quality parameters
        stream.getTracks().forEach(track => {
          const sender = pc.addTrack(track, stream);
          
          // Set encoding parameters for bitrate control
          const parameters = sender.getParameters();
          if (!parameters.encodings) {
            parameters.encodings = [{}];
          }
          parameters.encodings[0].maxBitrate = settings.bitrate;
          sender.setParameters(parameters);
        });

        pc.ontrack = (event) => {
          remoteVideoRef.current.srcObject = event.streams[0];
        };

        pc.onconnectionstatechange = () => {
          setStatus(pc.connectionState);
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        ws.send(JSON.stringify({
          type: offer.type,
          sdp: offer.sdp
        }));
      };

      ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'answer') {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(data));
        }
      };

      ws.onerror = () => {
        setError('WebSocket failed');
      };

    } catch (err) {
      setError(err.message);
      setStatus('failed');
    }
  };

  const stop = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (pcRef.current) {
      pcRef.current.close();
    }
    if (wsRef.current) {
      wsRef.current.close();
    }
    setStatus('disconnected');
  };

  const switchCamera = async () => {
    stop();
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
    setTimeout(() => start(), 500);
  };

  const changeQuality = (newQuality) => {
    stop();
    setQuality(newQuality);
    setTimeout(() => start(), 500);
  };

  useEffect(() => {
    return () => stop();
  }, []);

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial' }}>
      <h1>WebRTC Video Processor</h1>
      
      <div style={{ marginBottom: '20px' }}>
        <div style={{ marginBottom: '10px' }}>
          <button onClick={start} style={{ marginRight: '10px', padding: '10px 20px' }}>
            Start
          </button>
          <button onClick={stop} style={{ marginRight: '10px', padding: '10px 20px' }}>
            Stop
          </button>
          <button onClick={switchCamera} style={{ padding: '10px 20px' }}>
            Switch Camera ({facingMode === 'user' ? 'Front' : 'Back'})
          </button>
        </div>
        
        <div style={{ marginBottom: '10px' }}>
          <span style={{ marginRight: '10px' }}>Quality:</span>
          <button 
            onClick={() => changeQuality('low')} 
            style={{ 
              padding: '8px 15px', 
              marginRight: '5px',
              background: quality === 'low' ? '#007bff' : '#ccc'
            }}
          >
            Low (240p)
          </button>
          <button 
            onClick={() => changeQuality('medium')} 
            style={{ 
              padding: '8px 15px', 
              marginRight: '5px',
              background: quality === 'medium' ? '#007bff' : '#ccc'
            }}
          >
            Medium (480p)
          </button>
          <button 
            onClick={() => changeQuality('high')} 
            style={{ 
              padding: '8px 15px', 
              marginRight: '5px',
              background: quality === 'high' ? '#007bff' : '#ccc'
            }}
          >
            High (720p)
          </button>
          <button 
            onClick={() => changeQuality('ultra')} 
            style={{ 
              padding: '8px 15px',
              background: quality === 'ultra' ? '#007bff' : '#ccc'
            }}
          >
            Ultra (1080p)
          </button>
        </div>
        
        <div style={{ marginTop: '10px', fontSize: '14px', color: '#666' }}>
          Current: {qualitySettings[quality].width}x{qualitySettings[quality].height} @ {qualitySettings[quality].frameRate}fps, 
          {(qualitySettings[quality].bitrate / 1000000).toFixed(1)} Mbps
        </div>
        
        <div style={{ marginTop: '10px' }}>
          Status: {status}
        </div>
        {error && <div style={{ color: 'red', marginTop: '10px' }}>{error}</div>}
      </div>

      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '300px' }}>
          <h3>Your Camera</h3>
          <video 
            ref={localVideoRef}
            autoPlay 
            muted 
            playsInline
            style={{ width: '100%', background: 'black' }}
          />
        </div>
        
        <div style={{ flex: 1, minWidth: '300px' }}>
          <h3>Processed Video</h3>
          <video 
            ref={remoteVideoRef}
            autoPlay 
            playsInline
            style={{ width: '100%', background: 'black' }}
          />
        </div>
      </div>
    </div>
  );
}