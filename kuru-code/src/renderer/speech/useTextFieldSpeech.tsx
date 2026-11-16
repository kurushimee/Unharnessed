// kuru code: no voice input in text fields either.
export function useTextFieldSpeech(_input: { readonly [key: string]: unknown }) {
  return { available: false, active: false, freezesEditor: false };
}

export function TextFieldSpeechControls(_props: { readonly [key: string]: unknown }) {
  return null;
}
