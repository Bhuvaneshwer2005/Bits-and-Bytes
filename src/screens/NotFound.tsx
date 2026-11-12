import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <main id="main" className="screen">
      <header className="topbar">
        <Link to="/" className="btn">
          Home
        </Link>
      </header>
      <h1>Page not found</h1>
      <p className="card-box">That address doesn&rsquo;t lead anywhere. Go back home to upload notes or open a saved deck.</p>
      <Link to="/" className="btn btn--primary">
        Back to home
      </Link>
    </main>
  );
}
