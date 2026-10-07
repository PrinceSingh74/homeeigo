import { useEffect, useState } from "react";
import { KeyboardSpacer, NoteField } from "@/components/job/parts";
import { Banner, Button, Sheet, T } from "@/components/ui";
import { failureSentence, REASON_MAX, reasonState } from "@/lib/job-screen";

/**
 * Asks for the reason the server requires before a job is declined or cancelled (3–500 characters,
 * `/reject` and `/cancel`). The reason is the partner's own words: nothing is pre-filled and nothing
 * is sent for them. A refusal shows the server's sentence and keeps what was typed.
 */
export function ReasonSheet({
  visible,
  title,
  body,
  confirmLabel,
  keepLabel,
  onSubmit,
  onClose,
  testID,
}: {
  visible: boolean;
  title: string;
  /** What will happen, in plain words. */
  body: string;
  /** The destructive action, named for what it does ("Cancel this job"). */
  confirmLabel: string;
  /** The way out that changes nothing ("Keep this job"). */
  keepLabel: string;
  /** Sends the request. Rejects with the API error; resolves when the job has been read again. */
  onSubmit: (reason: string) => Promise<unknown>;
  onClose: () => void;
  testID?: string;
}) {
  const [text, setText] = useState("");
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) return;
    setText("");
    setTouched(false);
    setError(null);
  }, [visible]);

  const reason = reasonState(text);

  async function submit() {
    setTouched(true);
    if (!reason.valid || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSubmit(reason.value);
      onClose();
    } catch (err) {
      setError(failureSentence(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      dismissable={!sending}
      testID={testID}
      footer={
        <>
          <Button label={confirmLabel} variant="danger" onPress={() => void submit()} loading={sending} testID={testID ? `${testID}-submit` : undefined} />
          <Button label={keepLabel} variant="quiet" onPress={onClose} disabled={sending} testID={testID ? `${testID}-keep` : undefined} />
          <KeyboardSpacer />
        </>
      }
    >
      <T kind="body" tone="slate">
        {body}
      </T>
      <NoteField
        label="Reason"
        value={text}
        onChangeText={(v) => {
          setText(v);
          setError(null);
        }}
        maxLength={REASON_MAX}
        help={`${reason.value.length} of ${REASON_MAX} characters`}
        error={touched && !reason.valid ? reason.hint : null}
        testID={testID ? `${testID}-reason` : undefined}
      />
      {error ? <Banner tone="danger" message={error} testID={testID ? `${testID}-error` : undefined} /> : null}
    </Sheet>
  );
}
