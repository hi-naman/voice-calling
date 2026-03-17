const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Tell Express to serve the static files in our 'public' folder
app.use(express.static('public'));

// Add this right before io.on('connection', ...)
// This object will act as our server's memory to track rooms and users
const rooms = {}; 

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // --- NEW: Enhanced Join Room Logic ---
    socket.on('join-room', (roomCode) => {
        socket.join(roomCode);
        
        // If this room doesn't exist in our memory yet, create it
        if (!rooms[roomCode]) {
            rooms[roomCode] = [];
        }

        // Figure out the user's name based on how many people are already there
        const userNumber = rooms[roomCode].length + 1;
        const userName = `User ${userNumber}`;

        // Add this user to our server's memory for this room
        const newUser = { id: socket.id, name: userName };
        rooms[roomCode].push(newUser);

        console.log(`${userName} (${socket.id}) joined room: ${roomCode}`);

        // Broadcast the completely updated list of users to EVERYONE in the room
        io.to(roomCode).emit('room-users-update', rooms[roomCode]);
        
        // Keep track of which room this socket is in for when they disconnect
        socket.roomCode = roomCode; 
    });

    // --- NEW: Leave Room Logic ---
    socket.on('leave-room', () => {
        const roomCode = socket.roomCode;
        if (roomCode && rooms[roomCode]) {
            // Remove the user from our memory array
            rooms[roomCode] = rooms[roomCode].filter(user => user.id !== socket.id);
            
            // Tell everyone else in the room the new updated list
            io.to(roomCode).emit('room-users-update', rooms[roomCode]);
            
            // Tell the other person to hang up if a call was active
            socket.to(roomCode).emit('hangup');
            
            // Actually pull the socket out of the virtual room
            socket.leave(roomCode);
            socket.roomCode = null;
        }
    });

    // --- EXISTING: Relay WebRTC Signaling Data ---
    socket.on('offer', (roomCode, offer) => {
        socket.to(roomCode).emit('offer', offer);
    });

    socket.on('answer', (roomCode, answer) => {
        socket.to(roomCode).emit('answer', answer);
    });

    socket.on('ice-candidate', (roomCode, candidate) => {
        socket.to(roomCode).emit('ice-candidate', candidate);
    });

    socket.on('hangup', (roomCode) => {
        socket.to(roomCode).emit('hangup');
    });

    // --- UPDATED: Disconnect Logic ---
    socket.on('disconnect', () => {
        console.log('A user disconnected:', socket.id);
        // If they close the browser tab, treat it exactly like leaving the room
        if (socket.roomCode) {
            const roomCode = socket.roomCode;
            rooms[roomCode] = rooms[roomCode].filter(user => user.id !== socket.id);
            io.to(roomCode).emit('room-users-update', rooms[roomCode]);
            socket.to(roomCode).emit('hangup');
        }
    });
});

// Start the server on port 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});