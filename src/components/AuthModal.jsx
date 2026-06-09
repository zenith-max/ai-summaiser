import { useState } from 'react';

const API_URL = 'http://localhost:8000';

export default function AuthModal({ onClose, onAuth }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const isSignup = mode === 'signup';

  const updateField = (event) => {
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value
    }));
  };

  const submitAuth = async (event) => {
    event.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const endpoint = isSignup ? '/api/auth/signup' : '/api/auth/login';
      const payload = isSignup
        ? form
        : { email: form.email, password: form.password };

      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Authentication failed.');
      }

      onAuth(data.user);
      onClose();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-backdrop" role="presentation">
      <button className="auth-close-layer" type="button" aria-label="Close login" onClick={onClose} />
      <form className="auth-panel" onSubmit={submitAuth}>
        <button className="auth-x" type="button" aria-label="Close login" onClick={onClose}>
          x
        </button>
        <h2>{isSignup ? 'Sign up' : 'Sign in'}</h2>
        <p className="auth-subtitle">
          {isSignup ? 'Create your account below' : 'Enter your email below'}
        </p>

        {isSignup && (
          <label className="auth-field">
            <span>Name</span>
            <input
              name="name"
              type="text"
              value={form.name}
              onChange={updateField}
              placeholder="Your name"
              autoComplete="name"
              required
            />
          </label>
        )}

        <label className="auth-field">
          <span>Email</span>
          <input
            name="email"
            type="email"
            value={form.email}
            onChange={updateField}
            placeholder="abcd@example.com"
            autoComplete="email"
            required
          />
        </label>

        <label className="auth-field">
          <span className="password-row">
            Password
            {!isSignup && <button type="button">Forgot your Password ?</button>}
          </span>
          <input
            name="password"
            type="password"
            value={form.password}
            onChange={updateField}
            placeholder="password"
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            minLength="6"
            required
          />
        </label>

        {message && <p className="auth-message">{message}</p>}

        <button className="auth-submit" type="submit" disabled={loading}>
          {loading ? 'Please wait...' : isSignup ? 'Sign up' : 'Login'}
        </button>

        <div className="auth-divider">
          <span />
          <p>Or continue with</p>
          <span />
        </div>

        <button className="google-btn" type="button">
          <span>G</span>
          continue with google
        </button>

        <p className="auth-switch">
          {isSignup ? 'Already have an account ?' : "Don't you have an account ?"}
          <button type="button" onClick={() => setMode(isSignup ? 'login' : 'signup')}>
            {isSignup ? 'Sign in' : 'Sign up'}
          </button>
        </p>
      </form>
    </div>
  );
}
