import acc from '../assets/acc icon.png';
import logout from '../assets/log out button.png';

export default function Sidebar({ open, user, history = [], onHistoryClick, onLogout }) {
  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="profile">
        <div className="avatar">
          <img src={acc} alt="" />
        </div>
        <div className="profile-name">{user?.name || 'Name'}</div>
      </div>

      <div className="history-section">
        <button className="menu-item" type="button">History</button>
        <div className="history-list" aria-label="PDF upload history">
          {user && history.length > 0 ? (
            history.map((item) => (
              <button
                className="history-item"
                type="button"
                key={item.id}
                title={item.name}
                onClick={() => onHistoryClick?.(item)}
              >
                {item.name}
              </button>
            ))
          ) : (
            <p className="history-empty">{user ? 'No PDFs yet' : 'Login to view PDFs'}</p>
          )}
        </div>
      </div>
      <button className="menu-item" type="button">Saved</button>
      <button className="menu-item" type="button">Settings</button>

      <div className="logout-row">
        <button className="logout-btn" type="button" aria-label="Log out" onClick={onLogout}>
          <img src={logout} className="logout-img" alt="" />
        </button>
        <span className="logout-label">Log out</span>
      </div>
    </aside>
  );
}
