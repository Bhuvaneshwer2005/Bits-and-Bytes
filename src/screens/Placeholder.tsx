import { Link } from "react-router-dom";

interface Props {
  title: string;
  arrivesIn: string;
}

/** Stand-in for screens built in later steps (see docs/route-and-prompt-sheet.md). */
export default function Placeholder({ title, arrivesIn }: Props) {
  return (
    <main id="main" className="screen">
      <header className="topbar">
        <Link to="/" className="btn">
          Home
        </Link>
      </header>
      <h1>{title}</h1>
      <p className="card-box">This screen is coming in {arrivesIn}.</p>
    </main>
  );
}
