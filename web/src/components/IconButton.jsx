import { forwardRef } from 'react';
import Icon from './Icon.jsx';

// A button that shows only an icon. `label` is its accessible name (and the
// hover tooltip, unless `title` overrides that). `pressed` makes it a toggle:
// keep `label` the same and let aria-pressed say whether it's on.
const IconButton = forwardRef(function IconButton({ icon, label, size = 18, pressed, title, iconClassName, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={title ?? label}
      aria-pressed={pressed === undefined ? undefined : !!pressed}
      {...rest}
    >
      <Icon name={icon} size={size} className={iconClassName} />
    </button>
  );
});

export default IconButton;
