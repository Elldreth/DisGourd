// One setting: its name and help text on the left, its control on the right
// (P5-02). The row is a <label>, so a click on the words reaches a switch or
// checkbox inside it; pass `as="div"` when the control is a group of buttons.
export default function SettingRow({ label, description, children, as: Tag = 'label', className = '' }) {
  return (
    <Tag className={`tap-row flex items-center justify-between gap-4 py-2 ${Tag === 'label' ? 'cursor-pointer' : ''} ${className}`}>
      <span className="min-w-0">
        <span className="block text-sm text-gray-200">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-gray-500">{description}</span>}
      </span>
      {children}
    </Tag>
  );
}
