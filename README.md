# TODO:
# **2 main branch of developments**
# 1. Branch 1: VR Headset Simulation for real-time communication with server(If goes well, might buy real headset)
**1. Build simple client interface:**
- Temporarily uses web interface:
    + User open phone, access local website, hosted on computer.
    + Website can access user's camera
    + Camera collect live images and stream to server (For now, it's the computer)

**2. Build server**
- For now, the server will be hosted on my laptop
- The server only has RTX 3060 6GB VRAM for now:
- The server will be responsible for:
    + Video buffer and frame selection
    + Scene-graph construction and database
    + YOLO or any other scene attribute construction
    + MCP server with tooling
    + Sending rendering data to user
- Language model/agent to use: Qwen3-1.7B

# 2. Branch 2: Server heavy processing (Develop on kaggle)
**Note: When server is ready (fast and light enough) to process direct series of images from a live feed video, merge with branch 1**
- Branch 2 focus on **VGGT-SLAM with SceneScript** loop for incrementally construct 3D scene map.
- Currently working on Kaggle, development takes very long so cannot rent a GPU yet, just do development on T4, estimate time and memory and project to stronger GPU.

# 3. Merging branches
- For initial integration testing, still uses phone first.
- Try, attempt to deploy the server to free GPU service like free trial for Digital Ocean.
