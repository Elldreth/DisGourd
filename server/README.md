# DisGourd Server

This is a minimal WebSocket chat server implemented with only Node.js built-in modules. It allows creation of custom spaces and channels similar to Discord.

## Configuration

Edit `config.json` to change the listening port.

```
{
  "port": 3000
}
```

## API

### Create Space

```
POST /space
{"name": "mySpace"}
```

### Create Channel

```
POST /space/{space}/channel
{"name": "general"}
```

### WebSocket Connection

Connect to `/ws/{space}/{channel}`. Messages sent will be broadcast to other clients in the same channel.

## Running

```
node server.js
```

The server keeps all data in memory, so restarting will clear spaces and channels.

