import { StatusMessage } from "@libre-ai/ui";
import { useCallback, useRef, useState } from "react";

interface PassphraseGateProps {
  readonly mode: "set" | "enter";
  readonly error?: "too-short" | "wrong-passphrase";
  readonly onSubmit: (passphrase: string) => Promise<void>;
}

export function PassphraseGate({ mode, error, onSubmit }: PassphraseGateProps) {
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const passphraseInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setIsLoading(true);
      try {
        await onSubmit(passphrase);
      } finally {
        setIsLoading(false);
      }
    },
    [passphrase, onSubmit],
  );

  // Keep in sync with PASSPHRASE_MIN_LENGTH in use-questionnaire.ts (Art. 9 entropy margin).
  const MIN_LENGTH = 12;
  const isPassphraseTooShort = passphrase.length < MIN_LENGTH;
  const isConfirmMismatch = mode === "set" && passphrase !== confirm && confirm.length > 0;
  const isFormValid = !isPassphraseTooShort && (mode === "enter" || !isConfirmMismatch);

  return (
    <div className="passphrase-gate lai-card" data-testid="passphrase-gate">
      <form onSubmit={handleSubmit} noValidate>
        <div className="passphrase-gate-content">
          {mode === "set" ? (
            <>
              <h2 id="gate-title">Protégez vos réponses</h2>
              <p id="gate-description">
                Définissez une phrase secrète pour chiffrer vos réponses localement. Minimum 8
                caractères.
              </p>
              <p className="data-loss-warning">
                <strong>Attention :</strong> Si vous oubliez votre phrase secrète, vos réponses
                seront définitivement perdues. Il n'existe aucun moyen de les récupérer.
              </p>
            </>
          ) : (
            <>
              <h2 id="gate-title">Entrez votre phrase secrète</h2>
              <p id="gate-description">
                Votre premier appareil a enregistré vos réponses chiffrées. Entrez votre phrase
                secrète pour y accéder.
              </p>
            </>
          )}

          {error === "too-short" && (
            <StatusMessage
              className="lai-error"
              data-testid="error-too-short"
              role="alert"
              aria-live="polite"
            >
              La phrase secrète doit contenir au moins {MIN_LENGTH} caractères.
            </StatusMessage>
          )}

          {error === "wrong-passphrase" && (
            <StatusMessage
              className="lai-error"
              data-testid="error-wrong-passphrase"
              role="alert"
              aria-live="polite"
            >
              Phrase secrète incorrecte. Veuillez réessayer.
            </StatusMessage>
          )}

          {isConfirmMismatch && (
            <StatusMessage
              className="lai-error"
              data-testid="error-mismatch"
              role="alert"
              aria-live="polite"
            >
              Les deux phrases ne correspondent pas.
            </StatusMessage>
          )}

          <div className="form-group">
            <label htmlFor="passphrase-input">
              {mode === "set" ? "Phrase secrète" : "Phrase secrète"}
            </label>
            <input
              ref={passphraseInputRef}
              id="passphrase-input"
              type="password"
              autoComplete={mode === "set" ? "new-password" : "current-password"}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              disabled={isLoading}
              aria-invalid={isPassphraseTooShort && passphrase.length > 0}
              aria-describedby={isPassphraseTooShort ? "passphrase-length-hint" : undefined}
            />
            <div id="passphrase-length-hint" className="form-hint">
              {passphrase.length} / {MIN_LENGTH} caractères minimum
            </div>
          </div>

          {mode === "set" && (
            <div className="form-group">
              <label htmlFor="confirm-input">Confirmer la phrase secrète</label>
              <input
                id="confirm-input"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={isLoading}
                aria-invalid={isConfirmMismatch}
              />
            </div>
          )}

          <button
            type="submit"
            disabled={!isFormValid || isLoading}
            className="button-primary"
            data-testid="submit-passphrase"
          >
            {isLoading
              ? "Traitement..."
              : mode === "set"
                ? "Protéger mes réponses"
                : "Déverrouiller"}
          </button>
        </div>
      </form>

      <style>{`
        .passphrase-gate {
          padding: 2rem;
          margin: 2rem auto;
          max-width: 500px;
          border-radius: 8px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }

        .passphrase-gate h2 {
          margin: 0 0 0.5rem 0;
          font-size: 1.5rem;
        }

        .passphrase-gate-content > p {
          margin: 0.5rem 0 1rem 0;
          font-size: 0.95rem;
          line-height: 1.5;
        }

        .data-loss-warning {
          background: #fff3cd;
          color: #856404;
          padding: 1rem;
          border-radius: 4px;
          margin: 1rem 0;
        }

        .form-group {
          margin-bottom: 1rem;
        }

        .form-group label {
          display: block;
          margin-bottom: 0.5rem;
          font-weight: 500;
        }

        .form-group input {
          width: 100%;
          padding: 0.75rem;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 1rem;
        }

        .form-group input:focus {
          outline: none;
          border-color: #0066cc;
          box-shadow: 0 0 0 2px rgba(0, 102, 204, 0.1);
        }

        .form-group input[aria-invalid="true"] {
          border-color: #dc3545;
        }

        .form-hint {
          font-size: 0.85rem;
          color: #666;
          margin-top: 0.25rem;
        }

        .button-primary {
          width: 100%;
          padding: 0.75rem;
          background: #0066cc;
          color: white;
          border: none;
          border-radius: 4px;
          font-size: 1rem;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.2s;
        }

        .button-primary:hover:not(:disabled) {
          background: #0052a3;
        }

        .button-primary:disabled {
          background: #ccc;
          cursor: not-allowed;
        }

        .lai-error {
          background: #f8d7da;
          color: #721c24;
          padding: 1rem;
          border-radius: 4px;
          margin-bottom: 1rem;
        }
      `}</style>
    </div>
  );
}
