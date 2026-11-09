/**
 * The Leave confirm popover (REQ-049; DESIGN.md "Leave + confirm"). It opens under the Leave button,
 * traps focus between its two buttons, focuses Keep playing first, and closes on Esc. The match keeps
 * running while it is open.
 */
import { type KeyboardEvent, useEffect, useId, useRef } from 'react';
import { COPY } from '../copy.ts';
import { TEST_IDS } from '../testIds.ts';
import { Button } from './common.tsx';

export interface LeaveConfirmProps {
  readonly opponent: string;
  readonly onKeep: () => void;
  readonly onLeave: () => void;
}

export function LeaveConfirm({ opponent, onKeep, onLeave }: LeaveConfirmProps) {
  const keepRef = useRef<HTMLButtonElement>(null);
  const leaveRef = useRef<HTMLButtonElement>(null);
  const questionId = useId();

  useEffect(() => {
    keepRef.current?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onKeep();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const next = document.activeElement === keepRef.current ? leaveRef : keepRef;
      next.current?.focus();
    }
  };

  return (
    <div
      className="popover"
      role="dialog"
      aria-modal="true"
      aria-labelledby={questionId}
      onKeyDown={onKeyDown}
      data-testid={TEST_IDS.leaveConfirm.dialog}
    >
      <p id={questionId} className="popover__question">
        {COPY.leaveConfirm.question(opponent)}
      </p>
      <div className="popover__actions">
        <Button
          ref={keepRef}
          variant="secondary"
          onClick={onKeep}
          data-testid={TEST_IDS.leaveConfirm.keepPlaying}
        >
          {COPY.leaveConfirm.keepPlaying}
        </Button>
        <Button
          ref={leaveRef}
          variant="destructive"
          onClick={onLeave}
          data-testid={TEST_IDS.leaveConfirm.leaveSeries}
        >
          {COPY.leaveConfirm.leaveSeries}
        </Button>
      </div>
    </div>
  );
}
