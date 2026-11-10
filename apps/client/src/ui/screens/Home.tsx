/**
 * Home (REQ-047, REQ-058; DESIGN.md "Home", "Inputs", "Keyboard-needed warning", error catalogue).
 * `/` leads with Create game; `/g/:code` pre-fills the code, focuses the name and leads with Join game.
 */
import type { RoomCode } from '@stackerist/protocol';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArenaPage, Button, Logo } from '../components/common.tsx';
import { COPY } from '../copy.ts';
import type { KeyboardProof } from '../device.ts';
import type { ErrorPresentation } from '../errors.ts';
import {
  NAME_INPUT_MAX_UNITS,
  nameErrorText,
  nameProblem,
  type NameProblem,
  parseRoomCodeInput,
  sanitizeCodeInput,
  validateName,
} from '../names.ts';
import { TEST_IDS } from '../testIds.ts';

export type HomeMode = 'create' | 'join';
export type HomeBusy = 'create' | 'join' | null;

export interface HomeProps {
  readonly mode: HomeMode;
  readonly initialCode: string;
  readonly busy: HomeBusy;
  /** The store's last error, already mapped to its copy and place. */
  readonly error: ErrorPresentation | null;
  readonly onCreate: (name: string) => void;
  readonly onJoin: (code: RoomCode, name: string) => void;
  readonly onWatch: (code: RoomCode) => void;
  /** True on a touch-only device that hasn't pressed a physical key yet. */
  readonly needsKeyboardWarning: () => boolean;
  readonly keyboard: KeyboardProof;
}

type Pending =
  | { readonly action: 'create'; readonly name: string }
  | { readonly action: 'join'; readonly name: string; readonly code: RoomCode };

export function Home(props: HomeProps) {
  const { mode, busy, error, onCreate, onJoin, onWatch, keyboard } = props;
  const [name, setName] = useState('');
  const [code, setCode] = useState(() => sanitizeCodeInput(props.initialCode));
  const [nameIssue, setNameIssue] = useState<NameProblem | null>(null);
  const [codeInvalid, setCodeInvalid] = useState(false);
  const [warning, setWarning] = useState<Pending | null>(null);
  const [lastAction, setLastAction] = useState<'create' | 'join'>(mode);
  const nameRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const warningTitleRef = useRef<HTMLHeadingElement>(null);
  const ids = {
    name: useId(),
    nameError: useId(),
    code: useId(),
    codeError: useId(),
    plateError: useId(),
  };

  // On /g/:code the code is already there, so the name is the next thing to type.
  useEffect(() => {
    if (mode === 'join') nameRef.current?.focus();
  }, [mode]);

  // The warning replaces the plate content; its title takes focus.
  useEffect(() => {
    if (warning !== null) warningTitleRef.current?.focus();
  }, [warning]);

  // A physical key press while the warning is up proves a keyboard and continues the action.
  useEffect(() => {
    if (warning === null) return undefined;
    return keyboard.subscribe(() => {
      setWarning(null);
      if (warning.action === 'create') onCreate(warning.name);
      else onJoin(warning.code, warning.name);
    });
  }, [warning, keyboard, onCreate, onJoin]);

  const submitCreate = () => {
    if (busy !== null) return;
    setLastAction('create');
    const validName = validateName(name);
    setCodeInvalid(false);
    setNameIssue(nameProblem(name));
    if (validName === null) {
      nameRef.current?.focus();
      return;
    }
    if (props.needsKeyboardWarning()) {
      setWarning({ action: 'create', name: validName });
      return;
    }
    onCreate(validName);
  };

  const submitJoin = () => {
    if (busy !== null) return;
    setLastAction('join');
    const validName = validateName(name);
    const roomCode = parseRoomCodeInput(code);
    setNameIssue(nameProblem(name));
    setCodeInvalid(roomCode === null);
    if (validName === null) {
      nameRef.current?.focus();
      return;
    }
    if (roomCode === null) {
      codeRef.current?.focus();
      return;
    }
    if (props.needsKeyboardWarning()) {
      setWarning({ action: 'join', name: validName, code: roomCode });
      return;
    }
    onJoin(roomCode, validName);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (mode === 'create') submitCreate();
    else submitJoin();
  };

  const onCodeKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submitJoin();
  };

  const closeWarning = () => {
    setWarning(null);
  };

  const storeCodeError = error?.placement === 'code' ? error.text : null;
  const plateError = error?.placement === 'plate' ? error : null;
  const codeErrorText = codeInvalid ? COPY.errors.codeInvalid : storeCodeError;
  const locked = busy !== null;

  const nameField = (
    <div className="field">
      <label className="label" htmlFor={ids.name}>
        {COPY.home.nameLabel}
      </label>
      <input
        ref={nameRef}
        id={ids.name}
        className="input"
        type="text"
        name="name"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          if (nameIssue !== null) setNameIssue(null);
        }}
        autoComplete="nickname"
        autoCapitalize="words"
        spellCheck={false}
        maxLength={NAME_INPUT_MAX_UNITS}
        readOnly={locked}
        aria-disabled={locked ? true : undefined}
        aria-invalid={nameIssue !== null ? true : undefined}
        aria-describedby={nameIssue !== null ? ids.nameError : undefined}
        data-testid={TEST_IDS.home.nameInput}
      />
      {nameIssue !== null ? (
        <p
          id={ids.nameError}
          className="field-error"
          role="alert"
          data-testid={TEST_IDS.home.nameError}
        >
          {nameErrorText(nameIssue)}
        </p>
      ) : null}
    </div>
  );

  const codeInput = (
    <input
      ref={codeRef}
      id={ids.code}
      className="input input--code"
      type="text"
      name="code"
      value={code}
      onChange={(event) => {
        setCode(sanitizeCodeInput(event.target.value));
        if (codeInvalid) setCodeInvalid(false);
      }}
      onKeyDown={onCodeKeyDown}
      inputMode="text"
      autoCapitalize="characters"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      readOnly={locked}
      aria-disabled={locked ? true : undefined}
      aria-invalid={codeErrorText !== null ? true : undefined}
      aria-describedby={codeErrorText !== null ? ids.codeError : undefined}
      data-testid={TEST_IDS.home.codeInput}
    />
  );

  const codeError =
    codeErrorText !== null ? (
      <p
        id={ids.codeError}
        className="field-error"
        role="alert"
        data-testid={TEST_IDS.home.codeError}
      >
        {codeErrorText}
      </p>
    ) : null;

  const createButton = (variant: 'primary' | 'secondary', label: string) => (
    <Button
      variant={variant}
      type={mode === 'create' ? 'submit' : 'button'}
      onClick={mode === 'create' ? undefined : submitCreate}
      loading={busy === 'create'}
      loadingLabel={COPY.home.creating}
      disabled={busy === 'join'}
      className={variant === 'secondary' ? 'btn--block' : undefined}
      data-testid={TEST_IDS.home.createButton}
    >
      {label}
    </Button>
  );

  const joinButton = (variant: 'primary' | 'secondary', label: string) => (
    <Button
      variant={variant}
      type={mode === 'join' ? 'submit' : 'button'}
      onClick={mode === 'join' ? undefined : submitJoin}
      loading={busy === 'join'}
      loadingLabel={COPY.home.joining}
      disabled={busy === 'create'}
      data-testid={TEST_IDS.home.joinButton}
    >
      {label}
    </Button>
  );

  return (
    <ArenaPage testId={TEST_IDS.home.screen} className="home">
      <h1 className="home__brand">
        <Logo className="home__logo" />
      </h1>
      {warning !== null ? (
        <section
          className="plate plate--home"
          role="status"
          data-testid={TEST_IDS.keyboard.warning}
        >
          <h2
            ref={warningTitleRef}
            className="plate__title"
            tabIndex={-1}
            data-testid={TEST_IDS.keyboard.title}
          >
            {COPY.keyboard.title}
          </h2>
          <p className="prose">{COPY.keyboard.body}</p>
          <div className="plate__actions">
            {warning.action === 'join' ? (
              <Button
                variant="primary"
                onClick={() => {
                  setWarning(null);
                  onWatch(warning.code);
                }}
                data-testid={TEST_IDS.keyboard.watchButton}
              >
                {COPY.keyboard.watchInstead}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              onClick={closeWarning}
              data-testid={TEST_IDS.keyboard.backButton}
            >
              {COPY.keyboard.back}
            </Button>
          </div>
        </section>
      ) : (
        <section className="plate plate--home">
          {plateError !== null ? (
            <div className="plate-error" role="alert" data-testid={TEST_IDS.home.plateError}>
              <p id={ids.plateError}>{plateError.text}</p>
              {plateError.retry ? (
                <Button
                  variant="secondary"
                  onClick={lastAction === 'join' ? submitJoin : submitCreate}
                  disabled={locked}
                  data-testid={TEST_IDS.home.tryAgainButton}
                >
                  {COPY.home.tryAgain}
                </Button>
              ) : null}
            </div>
          ) : null}
          <form
            className="home-form"
            noValidate
            onSubmit={onSubmit}
            data-testid={TEST_IDS.home.form}
          >
            {nameField}
            {mode === 'create' ? (
              <>
                {createButton('primary', COPY.home.create)}
                <p className="divider">{COPY.home.divider}</p>
                <div className="field">
                  <label className="label" htmlFor={ids.code}>
                    {COPY.home.codeLabel}
                  </label>
                  <div className="code-row">
                    {codeInput}
                    {joinButton('secondary', COPY.home.join)}
                  </div>
                  {codeError}
                </div>
              </>
            ) : (
              <>
                {joinButton('primary', COPY.home.joinGame)}
                <div className="field">
                  <label className="label" htmlFor={ids.code}>
                    {COPY.home.codeLabel}
                  </label>
                  {codeInput}
                  {codeError}
                </div>
                <p className="divider">{COPY.home.dividerJoinMode}</p>
                {createButton('secondary', COPY.home.createInstead)}
              </>
            )}
          </form>
        </section>
      )}
    </ArenaPage>
  );
}
