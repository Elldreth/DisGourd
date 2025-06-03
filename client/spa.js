const { createApp, ref, computed, onMounted } = Vue;

createApp({
  setup() {
    const host = location.hostname;
    const port = location.port || 3000;

    const token = ref(localStorage.getItem('token') || '');
    const username = ref('');
    const password = ref('');
    const loggedIn = computed(() => !!token.value);

    const spaces = ref([]);
    const selectedSpace = ref('');
    const selectedChannel = ref('');
    const messages = ref([]);
    const members = ref(new Set());
    const friends = ref([]);
    const friendRequests = ref([]);
    const messageInputFriend = ref('');
    const messageInput = ref('');
    const ws = ref(null);
    const fileRef = ref(null);

    async function login() {
      const resp = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.value, password: password.value })
      });
      if (resp.ok) {
        const data = await resp.json();
        token.value = data.token;
        localStorage.setItem('token', data.token);
        await loadState();
        await loadFriends();
      } else {
        alert('Login failed');
      }
    }

    async function loadState() {
      const resp = await fetch('/admin/state');
      if (resp.ok) {
        const data = await resp.json();
        spaces.value = Object.keys(data).map(s => ({
          name: s,
          channels: Object.keys(data[s].channels)
        }));
      }
    }

    async function loadFriends() {
      if (!token.value) return;
      const resp = await fetch(`/friends?token=${token.value}`);
      if (resp.ok) {
        const data = await resp.json();
        friends.value = data.friends || [];
      }
      const r = await fetch(`/friends/requests?token=${token.value}`);
      if (r.ok) {
        const d = await r.json();
        friendRequests.value = d.requests || [];
      }
    }

    async function sendFriendRequest(to) {
      await fetch(`/friends/request?token=${token.value}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: to })
      });
      await loadFriends();
    }

    async function acceptFriend(from) {
      await fetch(`/friends/accept?token=${token.value}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: from })
      });
      await loadFriends();
    }

    async function rejectFriend(from) {
      await fetch(`/friends/reject?token=${token.value}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: from })
      });
      await loadFriends();
    }

    function select(space, channel) {
      selectedSpace.value = space;
      selectedChannel.value = channel;
      loadHistory();
      connectWS();
    }

    async function loadHistory() {
      if (!selectedSpace.value || !selectedChannel.value) return;
      const url = `/spaces/${encodeURIComponent(selectedSpace.value)}/channels/${encodeURIComponent(selectedChannel.value)}/messages?limit=50`;
      const resp = await fetch(url);
      if (resp.ok) {
        messages.value = await resp.json();
        members.value = new Set(messages.value.map(m => m.author).filter(Boolean));
      } else {
        messages.value = [];
        members.value = new Set();
      }
    }

    function connectWS() {
      if (ws.value) ws.value.close();
      if (!token.value || !selectedSpace.value || !selectedChannel.value) return;
      const wsUrl = `ws://${host}:${port}/ws/${encodeURIComponent(selectedSpace.value)}/${encodeURIComponent(selectedChannel.value)}?token=${token.value}`;
      ws.value = new WebSocket(wsUrl);
      ws.value.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { msg = { content: event.data }; }
        if (msg.type === 'friend_list') {
          friends.value = msg.friends;
          return;
        }
        if (msg.type === 'presence') {
          const f = friends.value.find(fr => fr.username === msg.user);
          if (f) f.online = msg.status === 'online';
          return;
        }
        messages.value.push(msg);
        if (msg.author) members.value.add(msg.author);
      };
    }

    async function sendMessage() {
      if (!ws.value || ws.value.readyState !== WebSocket.OPEN) return;
      const fileInput = fileRef.value;
      if (fileInput && fileInput.files.length > 0) {
        const file = fileInput.files[0];
        const res = await fetch(`/uploads?name=${encodeURIComponent(file.name)}`, {
          method: 'POST',
          body: file
        });
        if (res.ok) {
          const { url } = await res.json();
          ws.value.send(JSON.stringify({ attachment: url }));
        }
        fileInput.value = '';
      }
      const trimmed = messageInput.value.trim();
      if (trimmed) {
        ws.value.send(JSON.stringify({ content: trimmed }));
        messageInput.value = '';
      }
    }

    onMounted(() => {
      if (token.value) {
        loadState();
        loadFriends();
      }
    });

    return { username, password, login, loggedIn, spaces, selectedSpace, selectedChannel, select, messages, messageInput, sendMessage, members, fileRef, friends, friendRequests, sendFriendRequest, acceptFriend, rejectFriend, messageInputFriend };
  },

  template: `
<div v-if="!loggedIn" style="padding:1rem;">
  <h2>Login</h2>
  <input v-model="username" placeholder="Username" />
  <input v-model="password" placeholder="Password" type="password" />
  <button @click="login">Login</button>
</div>
<div v-else style="display:flex; flex:1; width:100%;">
  <div class="sidebar">
    <div v-for="sp in spaces" :key="sp.name">
      <strong>{{ sp.name }}</strong>
      <ul>
        <li v-for="ch in sp.channels" :key="ch">
          <a href="#" @click.prevent="select(sp.name, ch)">{{ ch }}</a>
        </li>
      </ul>
    </div>
    <div style="margin-top:1rem;">
      <h3>Friends</h3>
      <ul>
        <li v-for="f in friends" :key="f.username">
          {{ f.username }} <span v-if="f.online">(online)</span>
        </li>
      </ul>
      <input type="text" v-model="messageInputFriend" placeholder="Add friend" />
      <button @click="sendFriendRequest(messageInputFriend); messageInputFriend=''">Add</button>
      <div v-if="friendRequests.length">
        <h4>Requests</h4>
        <div v-for="r in friendRequests" :key="r">
          {{ r }}
          <button @click="acceptFriend(r)">Accept</button>
          <button @click="rejectFriend(r)">Reject</button>
        </div>
      </div>
    </div>
  </div>
  <div class="content">
    <div class="messages">
      <div v-for="(msg, idx) in messages" :key="idx">
        <strong v-if="msg.author">{{ msg.author }}:</strong>
        <span>{{ msg.content }}</span>
        <span v-if="msg.attachment_url || msg.attachment">
          <a :href="msg.attachment_url || msg.attachment" target="_blank">[file]</a>
        </span>
      </div>
    </div>
    <div class="input-area">
      <input type="text" v-model="messageInput" @keyup.enter="sendMessage" />
      <input type="file" ref="fileRef" />
      <button @click="sendMessage">Send</button>
    </div>
  </div>
  <div class="memberlist">
    <ul>
      <li v-for="m in Array.from(members)" :key="m">{{ m }}</li>
    </ul>
  </div>
</div>
`
}).mount('#app');
