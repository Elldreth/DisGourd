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
      if (token.value) loadState();
    });

    return { username, password, login, loggedIn, spaces, selectedSpace, selectedChannel, select, messages, messageInput, sendMessage, members, fileRef };
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
