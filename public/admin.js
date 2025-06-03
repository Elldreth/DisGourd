const statusContent = document.getElementById('status-content');
const spacesList = document.getElementById('spaces-list');
const channelsList = document.getElementById('channels-list');
const createSpaceForm = document.getElementById('create-space-form');
const createChannelForm = document.getElementById('create-channel-form');
const selectSpaceForChannel = document.getElementById('select-space-for-channel');

let state = {};

async function loadState() {
  const resp = await fetch('/admin/state');
  if (resp.ok) {
    state = await resp.json();
    renderSpaces();
    renderChannelSelect();
    renderChannels();
    statusContent.innerHTML = '<p>Server running</p>';
  } else {
    statusContent.innerHTML = '<p>Error loading state</p>';
  }
}

function renderSpaces() {
  spacesList.innerHTML = '';
  const ul = document.createElement('ul');
  Object.keys(state).forEach(name => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = name;
    span.style.cursor = 'pointer';
    span.addEventListener('click', () => {
      selectSpaceForChannel.value = name;
      renderChannels();
    });

    const renameBtn = document.createElement('button');
    renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', async () => {
      const newName = prompt('New space name:', name);
      if (newName && newName !== name) {
        await fetch(`/admin/spaces/${encodeURIComponent(name)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName })
        });
        await loadState();
      }
    });

    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete';
    delBtn.classList.add('delete-btn');
    delBtn.addEventListener('click', async () => {
      if (confirm(`Delete space '${name}'?`)) {
        await fetch(`/admin/spaces/${encodeURIComponent(name)}`, { method: 'DELETE' });
        await loadState();
      }
    });

    li.appendChild(span);
    li.appendChild(renameBtn);
    li.appendChild(delBtn);
    ul.appendChild(li);
  });
  if (!ul.children.length) {
    spacesList.innerHTML = '<p>No spaces defined</p>';
  } else {
    spacesList.appendChild(ul);
  }
}

function renderChannelSelect() {
  const current = selectSpaceForChannel.value;
  selectSpaceForChannel.innerHTML = '<option value="">-- Select Space --</option>';
  Object.keys(state).forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    selectSpaceForChannel.appendChild(opt);
  });
  if (current && state[current]) {
    selectSpaceForChannel.value = current;
  }
  if (!selectSpaceForChannel.value) {
    const first = Object.keys(state)[0];
    if (first) selectSpaceForChannel.value = first;
  }
}

function renderChannels() {
  const space = selectSpaceForChannel.value;
  channelsList.innerHTML = '';
  if (!space || !state[space]) {
    channelsList.innerHTML = '<p>Select a space to view channels</p>';
    return;
  }
  const ul = document.createElement('ul');
  Object.entries(state[space].channels).forEach(([name, info]) => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${name} (${info.clientCount || 0})`;

    const renameBtn = document.createElement('button');
    renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', async () => {
      const newName = prompt('New channel name:', name);
      if (newName && newName !== name) {
        await fetch(`/admin/spaces/${encodeURIComponent(space)}/channels/${encodeURIComponent(name)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName })
        });
        await loadState();
      }
    });

    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete';
    delBtn.classList.add('delete-btn');
    delBtn.addEventListener('click', async () => {
      if (confirm(`Delete channel '${name}' in space '${space}'?`)) {
        await fetch(`/admin/spaces/${encodeURIComponent(space)}/channels/${encodeURIComponent(name)}`, { method: 'DELETE' });
        await loadState();
      }
    });

    li.appendChild(label);
    li.appendChild(renameBtn);
    li.appendChild(delBtn);
    ul.appendChild(li);
  });
  if (!ul.children.length) {
    channelsList.innerHTML = '<p>No channels</p>';
  } else {
    channelsList.appendChild(ul);
  }
}

createSpaceForm.addEventListener('submit', async e => {
  e.preventDefault();
  const nameInput = document.getElementById('new-space-name');
  const name = nameInput.value.trim();
  if (!name) return;
  await fetch('/admin/spaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  nameInput.value = '';
  await loadState();
});

createChannelForm.addEventListener('submit', async e => {
  e.preventDefault();
  const space = selectSpaceForChannel.value;
  const nameInput = document.getElementById('new-channel-name');
  const name = nameInput.value.trim();
  if (!space || !name) return;
  await fetch(`/admin/spaces/${encodeURIComponent(space)}/channels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  nameInput.value = '';
  await loadState();
});

selectSpaceForChannel.addEventListener('change', renderChannels);

window.addEventListener('load', loadState);
