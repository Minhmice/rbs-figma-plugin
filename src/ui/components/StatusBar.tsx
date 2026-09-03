type Props = {
  message: string;
  tone?: "idle" | "loading" | "error" | "success";
};

export function StatusBar({ message, tone = "idle" }: Props) {
  return (
    <div
      className={`status${tone === "error" ? " error" : ""}${tone === "success" ? " success" : ""}${tone === "loading" ? " loading" : ""}`}
    >
      {tone === "loading" ? <div className="status-progress" aria-hidden /> : null}
      <div className="status-row">
        {tone === "loading" ? <span className="spinner" aria-hidden /> : null}
        <span>{message}</span>
      </div>
    </div>
  );
}
