import { initials, colorForName } from '../util.js';

export default function Avatar({ name, size = 40, status, src, speaking }) {
  const dot = {
    online: 'bg-online',
    offline: 'bg-gray-500',
    idle: 'bg-idle',
  }[status];

  return (
    <div
      className={`relative shrink-0 rounded-full ${speaking ? 'ring-2 ring-online' : ''}`}
      style={{ width: size, height: size }}
    >
      {src ? (
        <img
          src={src}
          alt={name}
          className="h-full w-full rounded-full object-cover"
          style={{ width: size, height: size }}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center rounded-full font-semibold text-white"
          style={{ backgroundColor: colorForName(name), fontSize: size * 0.38 }}
        >
          {initials(name)}
        </div>
      )}
      {status && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-ink-800 ${dot}`}
          style={{ width: size * 0.3, height: size * 0.3 }}
        />
      )}
    </div>
  );
}
