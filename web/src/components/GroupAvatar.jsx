import Avatar from './Avatar.jsx';

// A group DM's picture (P9-06d): two members' avatars overlapping, the
// others counted on a small chip. `members` excludes you (the caller decides).
export default function GroupAvatar({ members = [], size = 32 }) {
  const small = Math.round(size * 0.72);
  const [a, b] = members;
  const extra = members.length - 2;
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }} aria-hidden="true">
      <span className="absolute left-0 top-0">
        <Avatar name={a?.username} src={a?.avatar} size={small} />
      </span>
      {b && (
        <span className="absolute bottom-0 right-0 rounded-full ring-2 ring-ink-800">
          <Avatar name={b.username} src={b.avatar} size={small} />
        </span>
      )}
      {extra > 0 && (
        <span className="absolute -bottom-1 -left-1 rounded-full bg-ink-500 px-1 text-[10px] font-bold leading-4 text-fg ring-2 ring-ink-800">+{extra}</span>
      )}
    </span>
  );
}
