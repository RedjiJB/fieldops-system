import type { LucideIcon } from "lucide-react";
import { Button } from "./Button";

export function standardEmptyCopy(entity: string): { title: string; description: string; actionLabel: string } {
  return {
    title: `No ${entity} yet`,
    description: `Get started by creating your first ${entity.replace(/s$/, "")}.`,
    actionLabel: `Create your first ${entity.replace(/s$/, "")}`,
  };
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon-chip">
        <Icon size={24} />
      </span>
      <p className="empty-state-title">{title}</p>
      {description && <p className="empty-state-description">{description}</p>}
      {actionLabel && onAction && (
        <span className="empty-state-action">
          <Button variant="primary" onClick={onAction}>
            {actionLabel}
          </Button>
        </span>
      )}
    </div>
  );
}
