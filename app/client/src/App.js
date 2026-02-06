import { useEffect, useRef, useState, useCallback } from 'react';

export default function VideoProcessor() {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const [status, setStatus] = useState('disconnected');
  const [error, setError] = useState('');
  const [facingMode, setFacingMode] = useState('environment'); // Default to back camera for SLAM
  const [quality, setQuality] = useState('medium');
  
  // WebRTC Refs
  const pcRef = useRef(null);
  const wsRef = useRef(null);
  const streamRef = useRef(null);
  const imuChannelRef = useRef(null);

  // Sensor Refs (We use refs to avoid re-renders at 60Hz)
  const sensorsRef = useRef({ accel: null, gyro: null });
  const imuDataRef = useRef({
    acc: { x: 0, y: 0, z: 0 },
    gyro: { x: 0, y: 0, z: 0 },
    ts: 0
  });

  // Visualization State (Throttled updates for UI)
  const [imuMetrics, setImuMetrics] = useState({
    acc: { x: 0, y: 0, z: 0 },
    gyro: { x: 0, y: 0, z: 0 }
  });

  // Quality presets
  const qualitySettings = {
    low: { width: 320, height: 240, frameRate: 15, bitrate: 200000 },
    medium: { width: 640, height: 480, frameRate: 24, bitrate: 500000 },
    high: { width: 1280, height: 720, frameRate: 30, bitrate: 1500000 },
    ultra: { width: 1920, height: 1080, frameRate: 30, bitrate: 3000000 }
  };

  // --- IMU Setup Logic ---
  const startSensors = () => {
    if (!window.Accelerometer || !window.Gyroscope) {
      setError("Generic Sensor API not supported. Enable flags in chrome://flags or use HTTPS.");
      return;
    }

    try {
      // 1. Initialize Sensors
      // Note: Browser might cap frequency at 60Hz. 
      const accelerometer = new window.Accelerometer({ frequency: 60 });
      const gyroscope = new window.Gyroscope({ frequency: 60 });

      // 2. Handle Accelerometer
      accelerometer.addEventListener("reading", () => {
        // Update Ref for latest data
        imuDataRef.current.acc = { x: accelerometer.x, y: accelerometer.y, z: accelerometer.z };
        imuDataRef.current.ts = accelerometer.timestamp;
        sendIMUData();
      });

      // 3. Handle Gyroscope
      gyroscope.addEventListener("reading", () => {
        imuDataRef.current.gyro = { x: gyroscope.x, y: gyroscope.y, z: gyroscope.z };
        imuDataRef.current.ts = gyroscope.timestamp; // Update timestamp to latest
        sendIMUData();
      });

      accelerometer.start();
      gyroscope.start();

      sensorsRef.current = { accel: accelerometer, gyro: gyroscope };
      
    } catch (err) {
      setError(`Sensor Error: ${err.message}. Make sure you are on HTTPS.`);
    }
  };

  const stopSensors = () => {
    if (sensorsRef.current.accel) sensorsRef.current.accel.stop();
    if (sensorsRef.current.gyro) sensorsRef.current.gyro.stop();
  };

  // Function to push data to DataChannel
  const sendIMUData = () => {
    if (imuChannelRef.current && imuChannelRef.current.readyState === 'open') {
      const payload = JSON.stringify({
        type: 'imu',
        ts: imuDataRef.current.ts,
        acc: imuDataRef.current.acc,
        gyro: imuDataRef.current.gyro
      });
      imuChannelRef.current.send(payload);
    }
  };

  // UI Loop: Update visualization only 5 times a second (save React resources)
  useEffect(() => {
    const interval = setInterval(() => {
      setImuMetrics({
        acc: { ...imuDataRef.current.acc },
        gyro: { ...imuDataRef.current.gyro }
      });
    }, 200);
    return () => clearInterval(interval);
  }, []);


  // --- Main Start Logic ---
  const start = async () => {
    try {
      setStatus('connecting');
      setError('');
      
      // Start Sensors immediately
      startSensors();

      const settings = qualitySettings[quality];

      // Get camera
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
      const ws = new WebSocket('ws://192.168.1.50:8000/ws/signaling_handler');
      wsRef.current = ws;

      ws.onopen = async () => {
        const pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        pcRef.current = pc;

        // --- NEW: Create Data Channel for IMU ---
        const dc = pc.createDataChannel("imu", {
          ordered: false, // UDP-style (essential for sensors)
          maxRetransmits: 0 
        });
        imuChannelRef.current = dc;

        // Add track
        stream.getTracks().forEach(track => {
          const sender = pc.addTrack(track, stream);
          const parameters = sender.getParameters();
          if (!parameters.encodings) parameters.encodings = [{}];
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

        ws.send(JSON.stringify({ type: offer.type, sdp: offer.sdp }));
      };

      ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'answer') {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(data));
        }
      };

      ws.onerror = () => setError('WebSocket failed');

    } catch (err) {
      setError(err.message);
      setStatus('failed');
    }
  };

  const stop = () => {
    stopSensors();
    if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
    if (pcRef.current) pcRef.current.close();
    if (wsRef.current) wsRef.current.close();
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
      <h1>WebRTC + IMU Streamer</h1>
      
      {/* Controls */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ marginBottom: '10px' }}>
          <button onClick={start} style={{ marginRight: '10px', padding: '10px 20px', background: '#28a745', color: 'white', border: 'none', borderRadius: '4px' }}>
            Start Stream & Sensors
          </button>
          <button onClick={stop} style={{ marginRight: '10px', padding: '10px 20px', background: '#dc3545', color: 'white', border: 'none', borderRadius: '4px' }}>
            Stop
          </button>
          <button onClick={switchCamera} style={{ padding: '10px 20px' }}>
            Switch Camera ({facingMode === 'user' ? 'Front' : 'Back'})
          </button>
        </div>
        
        {/* Quality Controls */}
        <div style={{ marginBottom: '10px' }}>
          <span style={{ marginRight: '10px' }}>Quality:</span>
          {Object.keys(qualitySettings).map(q => (
            <button 
              key={q}
              onClick={() => changeQuality(q)} 
              style={{ 
                padding: '8px 15px', 
                marginRight: '5px',
                background: quality === q ? '#007bff' : '#ccc',
                color: 'white', border: 'none', borderRadius: '4px'
              }}
            >
              {q.charAt(0).toUpperCase() + q.slice(1)}
            </button>
          ))}
        </div>
        
        <div style={{ marginTop: '10px', fontSize: '14px', color: '#666' }}>
          Status: <strong>{status}</strong> | Video: {qualitySettings[quality].width}x{qualitySettings[quality].height}
        </div>
        {error && <div style={{ color: 'red', marginTop: '10px', fontWeight: 'bold' }}>Error: {error}</div>}
      </div>

      {/* Video Container */}
      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <div style={{ flex: 1, minWidth: '300px' }}>
          <h3>Local (Tab S9)</h3>
          <video ref={localVideoRef} autoPlay muted playsInline style={{ width: '100%', background: '#222', borderRadius: '8px' }} />
        </div>
        <div style={{ flex: 1, minWidth: '300px' }}>
          <h3>Server Echo</h3>
          <video ref={remoteVideoRef} autoPlay playsInline style={{ width: '100%', background: '#222', borderRadius: '8px' }} />
        </div>
      </div>

      {/* IMU VISUALIZATION DASHBOARD */}
      <div style={{ 
        background: '#f8f9fa', 
        padding: '15px', 
        borderRadius: '8px', 
        border: '1px solid #ddd',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '20px'
      }}>
        <div>
          <h4 style={{ margin: '0 0 10px 0', color: '#d35400' }}>Accelerometer (m/s²)</h4>
          <div style={{ fontFamily: 'monospace', fontSize: '1.2em' }}>
            <div>X: {imuMetrics.acc.x.toFixed(4)}</div>
            <div>Y: {imuMetrics.acc.y.toFixed(4)}</div>
            <div>Z: {imuMetrics.acc.z.toFixed(4)}</div>
          </div>
        </div>
        
        <div>
          <h4 style={{ margin: '0 0 10px 0', color: '#2980b9' }}>Gyroscope (rad/s)</h4>
          <div style={{ fontFamily: 'monospace', fontSize: '1.2em' }}>
            <div>X: {imuMetrics.gyro.x.toFixed(4)}</div>
            <div>Y: {imuMetrics.gyro.y.toFixed(4)}</div>
            <div>Z: {imuMetrics.gyro.z.toFixed(4)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}