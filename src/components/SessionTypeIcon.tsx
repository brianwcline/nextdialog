interface SessionTypeIconProps {
  icon: string;
  color?: string;
  className?: string;
}

export function SessionTypeIcon({ icon, color, className = "" }: SessionTypeIconProps) {
  if (icon.startsWith("/")) {
    return (
      <img
        src={icon}
        alt=""
        className={`w-4 h-4 ${className}`}
        style={{ filter: color ? undefined : undefined }}
      />
    );
  }
  return (
    <span className={className} style={{ color }}>
      {icon}
    </span>
  );
}
