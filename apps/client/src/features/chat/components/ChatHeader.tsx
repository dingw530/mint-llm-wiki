interface ChatHeaderProps {
  title: string;
}

export default function ChatHeader({ title }: ChatHeaderProps) {
  return (
    <div className="main-header">
      <h2>{title}</h2>
    </div>
  );
}
