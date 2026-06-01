// Full-screen blocking loader for long operations (training, profile removal…).
export default function LoadingOverlay({ show, message }) {
  if (!show) return null;
  return (
    <div className="overlay" role="alertdialog" aria-busy="true">
      <div className="overlay-box">
        <div className="spinner" />
        <div className="overlay-msg">{message || "Pracuji…"}</div>
      </div>
    </div>
  );
}
