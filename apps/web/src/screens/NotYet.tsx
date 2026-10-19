export function NotYet({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="panel">
      <h1>{title}</h1>
      <p className="notyet">not yet: {reason}</p>
    </div>
  );
}
