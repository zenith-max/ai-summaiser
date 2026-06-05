import menu from '../assets/menu bar.png';
import login from '../assets/login button.png';

export default function Header({ toggleSidebar, user, onLoginClick }) {
  return (
    <header className="header">
      <button className="hamburger" type="button" onClick={toggleSidebar} aria-label="Open menu">
        <img src={menu} className="menu-img" alt="" />
      </button>
      {!user && (
        <button className="login-btn" type="button" onClick={onLoginClick} aria-label="Log in">
          <img src={login} className="login-img" alt="" />
        </button>
      )}
    </header>
  );
}
