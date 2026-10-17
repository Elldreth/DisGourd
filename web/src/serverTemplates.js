// Starter channel sets for a new server, as shown to the user. The server's
// SERVER_TEMPLATES (server/db/index.js) is what actually creates them; an
// unknown id there falls back to 'blank'. Voice channels show with a speaker.
export const SERVER_TEMPLATES = [
  { id: 'blank', label: 'Blank', channels: ['#general'] },
  { id: 'friends', label: 'Friends', channels: ['#general', '#memes', '#media', '🔊 lounge'] },
  { id: 'gaming', label: 'Gaming', channels: ['#general', '#lfg', '#clips', '🔊 squad-1', '🔊 squad-2'] },
  { id: 'study', label: 'Study', channels: ['#general', '#resources', '#questions', '🔊 study-room'] },
];
