import React, { useState } from 'react';

// Mock Data
const SERVERS = [
  {
    id: 'dm',
    name: "Direct Messages",
    icon: null,
    isActive: false,
    isDM: true
  },
  {
    id: 1,
    name: "Retro Gaming Hub",
    icon: "https://images.unsplash.com/photo-1531525727990-67532cd332c6",
    isActive: true
  },
  {
    id: 2,
    name: "Controller Masters",
    icon: "https://images.unsplash.com/flagged/photo-1580234759288-fbf3ccdd9a06",
    isActive: false
  },
  {
    id: 3,
    name: "VR Lounge",
    icon: "https://images.pexels.com/photos/8728386/pexels-photo-8728386.jpeg",
    isActive: false
  },
  {
    id: 4,
    name: "Music Central",
    icon: "https://images.pexels.com/photos/972377/pexels-photo-972377.jpeg",
    isActive: false
  },
  {
    id: 5,
    name: "Tech Community",
    icon: "https://images.pexels.com/photos/5475761/pexels-photo-5475761.jpeg",
    isActive: false
  },
  {
    id: 6,
    name: "Study Group",
    icon: "https://images.pexels.com/photos/29367936/pexels-photo-29367936.jpeg",
    isActive: false
  },
  {
    id: 7,
    name: "Anime Lovers",
    icon: "https://images.pexels.com/photos/7267188/pexels-photo-7267188.jpeg",
    isActive: false
  },
  {
    id: 8,
    name: "Guitar Heroes",
    icon: "https://images.pexels.com/photos/8512209/pexels-photo-8512209.jpeg",
    isActive: false
  }
];

const CHANNELS = [
  {
    id: 1,
    name: "Welcome",
    type: "category"
  },
  {
    id: 2,
    name: "general",
    type: "text",
    category: "Welcome"
  },
  {
    id: 3,
    name: "announcements",
    type: "text",
    category: "Welcome"
  },
  {
    id: 4,
    name: "Gaming",
    type: "category"
  },
  {
    id: 5,
    name: "game-chat",
    type: "text",
    category: "Gaming"
  },
  {
    id: 6,
    name: "strategies",
    type: "text",
    category: "Gaming"
  },
  {
    id: 7,
    name: "General Voice",
    type: "voice",
    category: "Gaming"
  },
  {
    id: 8,
    name: "Game Room 1",
    type: "voice",
    category: "Gaming"
  }
];

const DIRECT_MESSAGES = [
  {
    id: 'dm1',
    user: "GamerPro2024",
    avatar: "https://images.pexels.com/photos/7658539/pexels-photo-7658539.jpeg",
    status: "online",
    lastMessage: "Ready for that co-op session?",
    timestamp: "2 min ago",
    unread: true
  },
  {
    id: 'dm2',
    user: "PixelMaster",
    avatar: "https://images.pexels.com/photos/7658146/pexels-photo-7658146.jpeg",
    status: "idle",
    lastMessage: "Check out this new game!",
    timestamp: "15 min ago",
    unread: false
  },
  {
    id: 'dm3',
    user: "RetroGamer",
    avatar: "https://images.unsplash.com/photo-1651249098063-b3a8855e2a5a",
    status: "dnd",
    lastMessage: "Thanks for the help earlier",
    timestamp: "1 hour ago",
    unread: false
  },
  {
    id: 'dm4',
    user: "VRExplorer",
    avatar: "https://images.pexels.com/photos/7562468/pexels-photo-7562468.jpeg",
    status: "offline",
    lastMessage: "See you tomorrow!",
    timestamp: "Yesterday",
    unread: false
  }
];

const FRIENDS = [
  {
    id: 1,
    username: "GamerPro2024",
    avatar: "https://images.pexels.com/photos/7658539/pexels-photo-7658539.jpeg",
    status: "online",
    activity: "Playing Cyberpunk 2077",
    statusText: "Ready to game!"
  },
  {
    id: 2,
    username: "PixelMaster",
    avatar: "https://images.pexels.com/photos/7658146/pexels-photo-7658146.jpeg",
    status: "idle",
    activity: "Listening to Spotify",
    statusText: "Vibing to music"
  },
  {
    id: 3,
    username: "RetroGamer",
    avatar: "https://images.unsplash.com/photo-1651249098063-b3a8855e2a5a",
    status: "dnd",
    activity: "Do Not Disturb",
    statusText: "Focused mode"
  },
  {
    id: 4,
    username: "VRExplorer",
    avatar: "https://images.pexels.com/photos/7562468/pexels-photo-7562468.jpeg",
    status: "offline",
    activity: "Last seen 2 hours ago",
    statusText: ""
  },
  {
    id: 5,
    username: "MusicLover",
    avatar: "https://images.pexels.com/photos/972377/pexels-photo-972377.jpeg",
    status: "online",
    activity: "Creating playlist",
    statusText: "Music is life"
  },
  {
    id: 6,
    username: "TechGuru",
    avatar: "https://images.pexels.com/photos/5475761/pexels-photo-5475761.jpeg",
    status: "online",
    activity: "Coding",
    statusText: "Building something cool"
  }
];

const MESSAGES = [
  {
    id: 1,
    user: "GamerPro2024",
    avatar: "https://images.pexels.com/photos/7658539/pexels-photo-7658539.jpeg",
    timestamp: "Today at 2:34 PM",
    content: "Hey everyone! Just finished an epic gaming session. Anyone up for some co-op later?",
    reactions: [{ emoji: "🎮", count: 3 }, { emoji: "🔥", count: 1 }]
  },
  {
    id: 2,
    user: "PixelMaster",
    avatar: "https://images.pexels.com/photos/7658146/pexels-photo-7658146.jpeg",
    timestamp: "Today at 2:36 PM",
    content: "Count me in! I've been working on my skills all week.",
    reactions: [{ emoji: "👍", count: 2 }]
  },
  {
    id: 3,
    user: "RetroGamer",
    avatar: "https://images.unsplash.com/photo-1651249098063-b3a8855e2a5a",
    timestamp: "Today at 2:38 PM",
    content: "The new update looks amazing! The graphics are incredible.",
    reactions: []
  },
  {
    id: 4,
    user: "VRExplorer",
    avatar: "https://images.pexels.com/photos/7658539/pexels-photo-7658539.jpeg",
    timestamp: "Today at 2:40 PM",
    content: "Just tried the VR mode - it's a complete game changer! 🥽",
    reactions: [{ emoji: "🤩", count: 4 }, { emoji: "🥽", count: 2 }]
  }
];

const DM_MESSAGES = {
  'dm1': [
    {
      id: 'dm1-1',
      user: "GamerPro2024",
      avatar: "https://images.pexels.com/photos/7658539/pexels-photo-7658539.jpeg",
      timestamp: "Today at 3:15 PM",
      content: "Hey! Ready for that co-op session we talked about?",
      reactions: []
    },
    {
      id: 'dm1-2',
      user: "You",
      avatar: null,
      timestamp: "Today at 3:16 PM",
      content: "Absolutely! I've been looking forward to it all day.",
      reactions: []
    },
    {
      id: 'dm1-3',
      user: "GamerPro2024",
      avatar: "https://images.pexels.com/photos/7658539/pexels-photo-7658539.jpeg",
      timestamp: "Today at 3:18 PM",
      content: "Perfect! Let me know when you're ready to hop on voice chat.",
      reactions: [{ emoji: "👍", count: 1 }]
    }
  ],
  'dm2': [
    {
      id: 'dm2-1',
      user: "PixelMaster",
      avatar: "https://images.pexels.com/photos/7658146/pexels-photo-7658146.jpeg",
      timestamp: "Today at 2:45 PM",
      content: "Check out this new game! It's got amazing pixel art.",
      reactions: []
    },
    {
      id: 'dm2-2',
      user: "You",
      avatar: null,
      timestamp: "Today at 2:50 PM",
      content: "Looks awesome! The art style reminds me of the old classics.",
      reactions: []
    }
  ]
};

// Server Sidebar Component
export const ServerSidebar = ({ servers, activeServer, onServerSelect }) => {
  return (
    <div className="bg-gray-900 w-18 flex flex-col items-center py-3 space-y-2">
      {/* Discord Home Button */}
      <div 
        className={`w-12 h-12 rounded-2xl flex items-center justify-center cursor-pointer hover:rounded-xl transition-all duration-200 ${
          activeServer === 'dm' ? 'bg-discord-blurple rounded-xl' : 'bg-discord-blurple hover:bg-discord-blurple'
        }`}
        onClick={() => onServerSelect('dm')}
      >
        <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.010c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
        </svg>
      </div>

      {/* Server Separator */}
      <div className="w-8 h-0.5 bg-gray-600 rounded-full"></div>

      {/* Server List */}
      {servers.filter(server => !server.isDM).map((server) => (
        <div
          key={server.id}
          className={`relative group cursor-pointer ${
            server.isActive ? '' : 'hover:rounded-xl'
          } transition-all duration-200`}
          onClick={() => onServerSelect(server.id)}
        >
          {/* Active indicator */}
          {activeServer === server.id && (
            <div className="absolute -left-1 top-0 bottom-0 w-1 bg-white rounded-r-full"></div>
          )}
          
          <div className={`w-12 h-12 ${
            activeServer === server.id ? 'rounded-xl' : 'rounded-3xl group-hover:rounded-xl'
          } overflow-hidden transition-all duration-200 bg-discord-dark`}>
            <img
              src={server.icon}
              alt={server.name}
              className="w-full h-full object-cover"
            />
          </div>

          {/* Server name tooltip */}
          <div className="absolute left-16 top-1/2 transform -translate-y-1/2 bg-gray-800 text-white px-3 py-2 rounded-lg text-sm whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50">
            {server.name}
            <div className="absolute left-0 top-1/2 transform -translate-y-1/2 -translate-x-full border-4 border-transparent border-r-gray-800"></div>
          </div>
        </div>
      ))}

      {/* Add Server Button */}
      <div className="w-12 h-12 bg-gray-700 rounded-3xl hover:rounded-xl hover:bg-green-600 flex items-center justify-center cursor-pointer transition-all duration-200 group">
        <svg className="w-6 h-6 text-green-500 group-hover:text-white" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/>
        </svg>
      </div>
    </div>
  );
};

// Channel Sidebar Component
export const ChannelSidebar = ({ channels, activeChannel, onChannelSelect, serverName }) => {
  const groupedChannels = channels.reduce((acc, channel) => {
    if (channel.type === 'category') {
      acc[channel.name] = [];
    } else if (channel.category) {
      if (!acc[channel.category]) acc[channel.category] = [];
      acc[channel.category].push(channel);
    }
    return acc;
  }, {});

  return (
    <div className="bg-gray-800 w-60 flex flex-col">
      {/* Server Header */}
      <div className="h-12 border-b border-gray-700 flex items-center px-4 shadow-md">
        <h1 className="text-white font-semibold text-sm truncate">{serverName}</h1>
        <svg className="w-4 h-4 text-gray-400 ml-auto cursor-pointer hover:text-white" fill="currentColor" viewBox="0 0 24 24">
          <path d="M7 10l5 5 5-5z"/>
        </svg>
      </div>

      {/* Channel List */}
      <div className="flex-1 overflow-y-auto">
        {Object.entries(groupedChannels).map(([categoryName, categoryChannels]) => (
          <div key={categoryName} className="mt-4">
            {/* Category Header */}
            <div className="px-2 mb-1">
              <div className="flex items-center text-xs text-gray-400 uppercase font-semibold tracking-wide px-2 hover:text-gray-300 cursor-pointer">
                <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
                </svg>
                {categoryName}
              </div>
            </div>
            
            {/* Channels in Category */}
            {categoryChannels.map((channel) => (
              <div
                key={channel.id}
                className={`mx-2 px-2 py-1 rounded cursor-pointer flex items-center group ${
                  activeChannel === channel.id
                    ? 'bg-gray-600 text-white'
                    : 'text-gray-300 hover:bg-gray-700 hover:text-gray-200'
                }`}
                onClick={() => onChannelSelect(channel.id)}
              >
                {channel.type === 'text' ? (
                  <svg className="w-5 h-5 mr-3 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M5,9V21H1V9H5M9,21A2,2 0 0,1 7,19V9C7,8.45 7.22,7.95 7.59,7.59L14.17,1L15.23,2.06C15.5,2.33 15.67,2.7 15.67,3.11L15.64,3.43L14.69,8H21C21.53,8 22,8.2 22.39,8.59C22.78,8.97 23,9.44 23,10V12C23,12.26 22.95,12.5 22.86,12.73L19.84,19.78C19.54,20.5 18.83,21 18,21H9M9,19H18.03L21,12V10H12.21L13.34,4.68L9,9.03V19Z"/>
                  </svg>
                ) : (
                  <svg className="w-5 h-5 mr-3 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12,2A3,3 0 0,1 15,5V11A3,3 0 0,1 12,14A3,3 0 0,1 9,11V5A3,3 0 0,1 12,2M19,11C19,14.53 16.39,17.44 13,17.93V21H11V17.93C7.61,17.44 5,14.53 5,11H7A5,5 0 0,0 12,16A5,5 0 0,0 17,11H19Z"/>
                  </svg>
                )}
                <span className="text-sm">{channel.name}</span>
                
                {/* Channel actions */}
                <div className="ml-auto opacity-0 group-hover:opacity-100 flex space-x-1">
                  <svg className="w-4 h-4 text-gray-400 hover:text-white cursor-pointer" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
                  </svg>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* User Area */}
      <div className="h-14 bg-gray-900 flex items-center px-2">
        <div className="flex items-center flex-1">
          <div className="w-8 h-8 rounded-full bg-discord-blurple flex items-center justify-center relative">
            <span className="text-white text-sm font-semibold">U</span>
            <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-green-500 rounded-full border-2 border-gray-900"></div>
          </div>
          <div className="ml-2 flex-1">
            <div className="text-white text-sm font-medium">User#1234</div>
            <div className="text-xs text-gray-400">Online</div>
          </div>
        </div>
        
        {/* User Controls */}
        <div className="flex space-x-2">
          <button className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12,2A3,3 0 0,1 15,5V11A3,3 0 0,1 12,14A3,3 0 0,1 9,11V5A3,3 0 0,1 12,2M19,11C19,14.53 16.39,17.44 13,17.93V21H11V17.93C7.61,17.44 5,14.53 5,11H7A5,5 0 0,0 12,16A5,5 0 0,0 17,11H19Z"/>
            </svg>
          </button>
          <button className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17,10.5V7A1,1 0 0,0 16,6H4A1,1 0 0,0 3,7V17A1,1 0 0,0 4,18H16A1,1 0 0,0 17,17V13.5L21,17.5V6.5L17,10.5Z"/>
            </svg>
          </button>
          <button className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.35 19.43,11.03L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.22,8.95 2.27,9.22 2.46,9.37L4.57,11.03C4.53,11.35 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.22,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.68 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

// Message Component
export const Message = ({ message }) => {
  return (
    <div className="flex hover:bg-gray-800 hover:bg-opacity-30 px-4 py-2 group">
      <div className="w-10 h-10 rounded-full overflow-hidden mr-4 flex-shrink-0">
        <img src={message.avatar} alt={message.user} className="w-full h-full object-cover" />
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline mb-1">
          <span className="text-white font-medium text-sm mr-2">{message.user}</span>
          <span className="text-gray-400 text-xs">{message.timestamp}</span>
        </div>
        
        <div className="text-gray-300 text-sm leading-relaxed break-words">
          {message.content}
        </div>
        
        {/* Reactions */}
        {message.reactions && message.reactions.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {message.reactions.map((reaction, index) => (
              <div
                key={index}
                className="flex items-center bg-gray-700 hover:bg-gray-600 rounded px-2 py-1 cursor-pointer transition-colors"
              >
                <span className="text-sm mr-1">{reaction.emoji}</span>
                <span className="text-xs text-gray-300">{reaction.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* Message Actions */}
      <div className="opacity-0 group-hover:opacity-100 flex items-start space-x-1 ml-4">
        <button className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z"/>
          </svg>
        </button>
        <button className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
          </svg>
        </button>
      </div>
    </div>
  );
};

// Chat Area Component
export const ChatArea = ({ messages, activeChannelName }) => {
  return (
    <div className="flex-1 flex flex-col bg-gray-700">
      {/* Chat Header */}
      <div className="h-12 border-b border-gray-600 flex items-center px-4 shadow-sm">
        <svg className="w-6 h-6 text-gray-400 mr-2" fill="currentColor" viewBox="0 0 24 24">
          <path d="M5,9V21H1V9H5M9,21A2,2 0 0,1 7,19V9C7,8.45 7.22,7.95 7.59,7.59L14.17,1L15.23,2.06C15.5,2.33 15.67,2.7 15.67,3.11L15.64,3.43L14.69,8H21C21.53,8 22,8.2 22.39,8.59C22.78,8.97 23,9.44 23,10V12C23,12.26 22.95,12.5 22.86,12.73L19.84,19.78C19.54,20.5 18.83,21 18,21H9M9,19H18.03L21,12V10H12.21L13.34,4.68L9,9.03V19Z"/>
        </svg>
        <h2 className="text-white font-semibold">{activeChannelName}</h2>
        
        {/* Chat Header Actions */}
        <div className="ml-auto flex items-center space-x-4">
          <button className="text-gray-400 hover:text-white">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12,2C13.1,2 14,2.9 14,4C14,5.1 13.1,6 12,6C10.9,6 10,5.1 10,4C10,2.9 10.9,2 12,2M21,9V7L15,1H5C3.89,1 3,1.89 3,3V18A2,2 0 0,0 5,20H19A2,2 0 0,0 21,18V9M19,9H14V4H5V18H19V9Z"/>
            </svg>
          </button>
          <button className="text-gray-400 hover:text-white">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4M11,16.5L18,9.5L16.59,8.09L11,13.67L7.91,10.59L6.5,12L11,16.5Z"/>
            </svg>
          </button>
          <button className="text-gray-400 hover:text-white">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M15.5,14H20.5L22,15.5V9.5L20.5,8H15.5L14,9.5V12.5L15.5,14M16,13V10H20V13H16M6,2C4.89,2 4,2.89 4,4V16A2,2 0 0,0 6,18H9L12,21L15,18H18A2,2 0 0,0 20,16V15H18V16H14.83L12,18.83L9.17,16H6V4H18V8H20V4A2,2 0 0,0 18,2H6Z"/>
            </svg>
          </button>
          <button className="text-gray-400 hover:text-white">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M15.5,17C18,17 20,15 20,12.5C20,10 18,8 15.5,8C13,8 11,10 11,12.5C11,15 13,17 15.5,17M12,12.5C12,14.43 13.57,16 15.5,16C17.43,16 19,14.43 19,12.5C19,10.57 17.43,9 15.5,9C13.57,9 12,10.57 12,12.5M15.5,11A1.5,1.5 0 0,0 14,12.5A1.5,1.5 0 0,0 15.5,14A1.5,1.5 0 0,0 17,12.5A1.5,1.5 0 0,0 15.5,11Z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto">
        {messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}
      </div>

      {/* Message Input */}
      <div className="p-4">
        <div className="bg-gray-600 rounded-lg px-4 py-3 flex items-center">
          <button className="text-gray-400 hover:text-white mr-4">
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M5,17H19V19H5V17M12,5L15.5,8.5L14.08,9.92L13,8.83V15H11V8.83L9.92,9.92L8.5,8.5L12,5Z"/>
            </svg>
          </button>
          
          <input
            type="text"
            placeholder={`Message #${activeChannelName}`}
            className="flex-1 bg-transparent text-white placeholder-gray-400 focus:outline-none"
          />
          
          <div className="flex items-center space-x-3 ml-4">
            <button className="text-gray-400 hover:text-white">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4C12.76,4 13.5,4.11 14.2,4.31L15.77,2.74C14.61,2.26 13.34,2 12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12M7.91,10.08L6.5,11.5L11,16L21,6L19.59,4.58L11,13.17L7.91,10.08Z"/>
              </svg>
            </button>
            <button className="text-gray-400 hover:text-white">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M9,2V8H7V2H9M17,2V8H15V2H17M12,8.5A0.5,0.5 0 0,1 11.5,8V2.5A0.5,0.5 0 0,1 12,2A0.5,0.5 0 0,1 12.5,2.5V8A0.5,0.5 0 0,1 12,8.5M12,12A4,4 0 0,1 8,8H16A4,4 0 0,1 12,12M19,10V16L17,14V10H19M5,10V16L7,14V10H5M12,13.5L18,22H6L12,13.5Z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Main Discord Component
export const DiscordClone = () => {
  const [activeServer, setActiveServer] = useState(1);
  const [activeChannel, setActiveChannel] = useState(2);

  const currentServer = SERVERS.find(s => s.id === activeServer);
  const currentChannel = CHANNELS.find(c => c.id === activeChannel);

  return (
    <div className="h-screen flex bg-gray-800 text-white">
      <ServerSidebar
        servers={SERVERS}
        activeServer={activeServer}
        onServerSelect={setActiveServer}
      />
      
      <ChannelSidebar
        channels={CHANNELS}
        activeChannel={activeChannel}
        onChannelSelect={setActiveChannel}
        serverName={currentServer?.name || "Server"}
      />
      
      <ChatArea
        messages={MESSAGES}
        activeChannelName={currentChannel?.name || "general"}
      />
    </div>
  );
};