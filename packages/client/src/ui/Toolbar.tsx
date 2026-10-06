import type { PanelId, ToolbarItem } from './toolbar-items.js';

interface Props {
  items: readonly ToolbarItem[];
  open: PanelId | null;
  onToggle: (id: PanelId) => void;
}

export function Toolbar({ items, open, onToggle }: Props) {
  return (
    <div role="toolbar" aria-label="Table tools" className="ui-toolbar">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-pressed={open === item.id}
          onClick={() => {
            onToggle(item.id);
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
