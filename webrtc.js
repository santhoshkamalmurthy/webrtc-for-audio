let signalingChannel;
let localStream;
let peerConnections = new Map();
let roomId;
let joinTime;
let timerInterval;
let userId = Math.random().toString(36).substr(2, 9);

const config = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

// UI Elements
const joinForm = document.getElementById('joinForm');
const roomUI = document.getElementById('roomUI');
const joinBtn = document.getElementById('joinBtn');
const leaveBtn = document.getElementById('leaveBtn');
const muteBtn = document.getElementById('muteBtn');
const roomInput = document.getElementById('roomId');
const roomDisplay = document.getElementById('roomDisplay');
const timer = document.getElementById('timer');
const participants = document.getElementById('participants');
const userCount = document.getElementById('userCount');
const userList = document.getElementById('userList');

async function joinRoom() {
    roomId = roomInput.value.trim();
    if (!roomId) return;

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        signalingChannel = new WebSocket(`wss://10.2.1.56:8080`);
        setupSignaling();
        
        joinTime = Date.now();
        updateTimer();
        timerInterval = setInterval(updateTimer, 1000);

        joinForm.classList.add('hidden');
        roomUI.classList.remove('hidden');
        roomDisplay.textContent = roomId;
    } catch (e) {
        console.error('Error joining room:', e);
        alert('Error joining room: ' + e.message);
    }
}

function setupSignaling() {
    signalingChannel.onopen = () => {
        signalingChannel.send(JSON.stringify({
            type: 'join',
            roomId,
            userId
        }));
    };

    signalingChannel.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        console.log('Received message:', data);

        switch (data.type) {
            case 'roomUpdate':
                updateUserList(data.users);
                break;
            case 'userJoined':
                if (data.userId !== userId) {
                    createPeerConnection(data.userId);
                }
                break;
            case 'userLeft':
                removePeerConnection(data.userId);
                break;
            case 'offer':
                if (data.userId !== userId) {
                    await handleOffer(data.offer, data.userId);
                }
                break;
            case 'answer':
                if (data.userId !== userId) {
                    await handleAnswer(data.answer, data.userId);
                }
                break;
            case 'iceCandidate':
                if (data.userId !== userId) {
                    await handleIceCandidate(data.candidate, data.userId);
                }
                break;
        }
    };

    signalingChannel.onerror = (error) => {
        console.error('WebSocket error:', error);
        alert('Connection error. Please try again.');
    };
}

function updateUserList(users) {
    userCount.textContent = users.length;
    userList.innerHTML = users.map(u => 
        `<div class="px-2 py-1 bg-gray-100 rounded">${u === userId ? 'You' : `User ${u.slice(0,4)}`}</div>`
    ).join('');
}

function createPeerConnection(peerId) {
    const pc = new RTCPeerConnection(config);
    peerConnections.set(peerId, pc);
    
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            const candidateInfo = {
                type: event.candidate.type,     // srflx (STUN), relay (TURN)
                protocol: event.candidate.protocol,
                address: event.candidate.address
            };
            console.log("ICE candidate:", candidateInfo);
            signalingChannel.send(JSON.stringify({
                type: 'iceCandidate',
                candidate: event.candidate,
                userId,
                targetUserId: peerId,
                roomId
            }));
        }
    };

    pc.ontrack = (event) => {
        const audioEl = document.createElement('audio');
        audioEl.srcObject = event.streams[0];
        audioEl.autoplay = true;
        audioEl.id = `audio-${peerId}`;
        participants.appendChild(audioEl);
    };

    pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => {
            signalingChannel.send(JSON.stringify({
                type: 'offer',
                offer: pc.localDescription,
                userId,
                targetUserId: peerId,
                roomId
            }));
        });

    return pc;
}

function removePeerConnection(peerId) {
    const pc = peerConnections.get(peerId);
    if (pc) {
        pc.close();
        peerConnections.delete(peerId);
    }
    const audioEl = document.getElementById(`audio-${peerId}`);
    if (audioEl) audioEl.remove();
}

async function handleOffer(offer, peerId) {
    let pc = peerConnections.get(peerId);
    if (!pc) {
        pc = new RTCPeerConnection(config);
        peerConnections.set(peerId, pc);
        
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                const candidateInfo = {
                    type: event.candidate.type,     // srflx (STUN), relay (TURN)
                    protocol: event.candidate.protocol,
                    address: event.candidate.address
                };
                console.log("ICE candidate of receiver:", candidateInfo);
                signalingChannel.send(JSON.stringify({
                    type: 'iceCandidate',
                    candidate: event.candidate,
                    userId,
                    targetUserId: peerId,
                    roomId
                }));
            }
        };

        pc.ontrack = (event) => {
            const audioEl = document.createElement('audio');
            audioEl.srcObject = event.streams[0];
            audioEl.autoplay = true;
            audioEl.id = `audio-${peerId}`;
            participants.appendChild(audioEl);
        };
    }

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    signalingChannel.send(JSON.stringify({
        type: 'answer',
        answer,
        userId,
        targetUserId: peerId,
        roomId
    }));
}

async function handleAnswer(answer, peerId) {
    const pc = peerConnections.get(peerId);
    if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
}

async function handleIceCandidate(candidate, peerId) {
    const pc = peerConnections.get(peerId);
    if (pc) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
}

function updateTimer() {
    const elapsed = Math.floor((Date.now() - joinTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    timer.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

joinBtn.addEventListener('click', joinRoom);

leaveBtn.addEventListener('click', () => {
    if (signalingChannel) {
        signalingChannel.send(JSON.stringify({
            type: 'leave',
            userId,
            roomId
        }));
    }
    
    clearInterval(timerInterval);
    peerConnections.forEach(pc => pc.close());
    peerConnections.clear();
    
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    
    joinForm.classList.remove('hidden');
    roomUI.classList.add('hidden');
});

muteBtn.addEventListener('click', () => {
    const audioTrack = localStream.getAudioTracks()[0];
    audioTrack.enabled = !audioTrack.enabled;
    muteBtn.textContent = audioTrack.enabled ? '🎤' : '🔇';
});