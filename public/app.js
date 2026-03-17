// Connect to the signaling server
const socket = io();

// Get DOM Elements
const micSelect = document.getElementById('mic-select');

// Global variable to hold our audio stream
let localStream;

// Function to start the microphone and populate the dropdown
async function initMedia() {
    try {
        // 1. Ask the user for microphone permission
        // This triggers the "Allow Microphone" popup in the browser
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log("Microphone access granted!");

        // 2. Get the list of all media devices
        const devices = await navigator.mediaDevices.enumerateDevices();
        
        // 3. Filter out cameras/speakers to only get microphones
        const audioInputs = devices.filter(device => device.kind === 'audioinput');

        // 4. Populate the dropdown menu
        micSelect.innerHTML = ''; // Clear any default options
        audioInputs.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            // If the browser doesn't give a name, provide a fallback name
            option.text = device.label || `Microphone ${micSelect.length + 1}`;
            micSelect.appendChild(option);
        });

        // 5. Check if the user has a saved microphone preference (Feature: Save Device)
        const savedMicId = localStorage.getItem('preferredMicId');
        if (savedMicId) {
            // Check if the saved mic is actually currently plugged in
            const micExists = [...micSelect.options].some(opt => opt.value === savedMicId);
            if (micExists) {
                micSelect.value = savedMicId;
            }
        }

    } catch (error) {
        console.error("Error accessing microphone:", error);
        alert("Please allow microphone access to use the calling feature.");
    }
}

// 6. Listen for changes on the dropdown to save the new preference
micSelect.addEventListener('change', () => {
    localStorage.setItem('preferredMicId', micSelect.value);
    console.log("Saved microphone preference:", micSelect.value);
    
    // In the future, we will add code here to switch the live audio track
});

// Run the setup when the script loads
initMedia();

// --- NEW CODE: Room Logic ---

// Get DOM Elements for the Room UI
const roomInput = document.getElementById('room-input');
const joinBtn = document.getElementById('join-btn');
const roomControls = document.getElementById('room-controls');
const callControls = document.getElementById('call-controls');
const currentRoomText = document.getElementById('current-room');
const statusText = document.getElementById('status-text');
const usersList = document.getElementById('users-list');
const leaveBtn = document.getElementById('leave-btn');

// Variable to keep track of what room we are in
let currentRoom = '';

// When the user clicks "Join Room"
joinBtn.addEventListener('click', () => {
    const roomCode = roomInput.value.trim();
    
    if (roomCode !== '') {
        currentRoom = roomCode;
        
        // Tell our Node.js server to put us in this room
        socket.emit('join-room', currentRoom);

        // Update the User Interface
        roomControls.style.display = 'none';      // Hide the input
        callControls.style.display = 'block';     // Show the Call/Mute buttons
        currentRoomText.innerText = currentRoom;
        statusText.innerText = `Status: In Room "${currentRoom}". Waiting for someone else...`;
    } else {
        alert("Please enter a room code first!");
    }
});

// --- NEW: Dynamic User List Rendering ---
// Listen for the server sending the updated array of users
socket.on('room-users-update', (users) => {
    // 1. Clear out the old list
    usersList.innerHTML = '';
    
    // 2. Loop through the array and create an HTML list item for each person
    users.forEach(user => {
        const li = document.createElement('li');
        // Add " (You)" next to your own name so you know which one you are!
        li.textContent = user.name + (user.id === socket.id ? ' (You)' : '');
        usersList.appendChild(li);
    });

    // 3. Update the status text based on how many people are in the room
    if (users.length === 1) {
        statusText.innerText = `Status: In Room "${currentRoom}". Waiting for someone else...`;
    } else {
        statusText.innerText = "Status: Users are in the room. Ready to call.";
    }
});

// --- NEW CODE: WebRTC Peer Connection ---

const callBtn = document.getElementById('call-btn');
const remoteAudio = document.getElementById('remote-audio');

let peerConnection;

// Configuration using a free public STUN server from Google
const rtcSettings = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

// Function to set up the WebRTC connection
function createPeerConnection() {
    peerConnection = new RTCPeerConnection(rtcSettings);

    // 1. Feed our local microphone audio into the connection
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    // 2. When the browser finds a network path (ICE Candidate), send it to the other user
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', currentRoom, event.candidate);
        }
    };

    // 3. When the other user's audio arrives, play it in our hidden <audio> tag!
    peerConnection.ontrack = (event) => {
        console.log("Remote audio received!");
        remoteAudio.srcObject = event.streams[0];
    };
}

// --- The Call Handshake Logic ---

// When User A clicks the "Call" button
callBtn.addEventListener('click', async () => {
    createPeerConnection();

    // Generate the "Offer" containing our media capabilities
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    // Send the Offer to User B via our Node.js signaling server
    socket.emit('offer', currentRoom, offer);
    statusText.innerText = "Status: Calling...";
});

// When User B receives the "Offer" from User A
socket.on('offer', async (offer) => {
    // If User B hasn't set up a connection yet, do it now
    if (!peerConnection) createPeerConnection();

    // Accept User A's Offer
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    
    // Generate an "Answer"
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    // Send the Answer back to User A
    socket.emit('answer', currentRoom, answer);
    statusText.innerText = "Status: Call Connected!";
});

// When User A receives the "Answer" from User B
socket.on('answer', async (answer) => {
    // User A accepts the Answer, completing the handshake
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    statusText.innerText = "Status: Call Connected!";
});

// When either user receives a network path (ICE Candidate) from the other
socket.on('ice-candidate', async (candidate) => {
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
        console.error("Error adding received ice candidate", e);
    }
});


// --- NEW CODE: Call Controls (Mute & Hang Up) ---

const muteBtn = document.getElementById('mute-btn');
const hangupBtn = document.getElementById('hangup-btn');

let isMuted = false;

// 1. Mute Button Logic
muteBtn.addEventListener('click', () => {
    // Grab the first audio track from our local microphone stream
    const audioTrack = localStream.getAudioTracks()[0];
    
    if (audioTrack) {
        // Toggle the state
        isMuted = !isMuted;
        
        // true = mic is live, false = mic is muted
        audioTrack.enabled = !isMuted; 
        
        // Update the button text
        muteBtn.innerText = isMuted ? "Unmute" : "Mute";
        console.log(isMuted ? "Microphone muted" : "Microphone unmuted");
    }
});

// 2. Hang Up Button Logic
function endCall() {
    // Close the WebRTC connection
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    // Reset the UI status
    statusText.innerText = `Status: Call Ended. You are still in room "${currentRoom}".`;
    
    // Tell the signaling server we hung up so it can notify the other person
    socket.emit('hangup', currentRoom);
}

hangupBtn.addEventListener('click', endCall);

// 3. Listen for the other user hanging up
socket.on('hangup', () => {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    statusText.innerText = "Status: The other user ended the call.";
});

// --- NEW: Leave Room Logic ---
leaveBtn.addEventListener('click', () => {
    // 1. Tell the Node.js server to remove us from this room
    socket.emit('leave-room');
    
    // 2. Hang up the WebRTC connection if a call is currently active
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    // 3. Reset the User Interface completely
    callControls.style.display = 'none';      // Hide the call buttons
    roomControls.style.display = 'block';     // Show the join input again
    roomInput.value = '';                     // Clear the input field
    currentRoom = '';
    
    // 4. Update the status text
    statusText.innerText = "Status: Left the room. Enter a new code to join.";
});