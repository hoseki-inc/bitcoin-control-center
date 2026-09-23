// NOTE: These are put here because they are used by both <Input> and <Textarea>
export const inputProps = {
  border: '1px solid',
  borderColor: 'border.subtle',
  borderRadius: 'control',

  color: 'text.primary',
  textStyle: 'text/md',

  px: '3',
  py: '2',

  outline: 0,
  outlineOffset: 0,

  _placeholder: {
    textStyle: 'text/md',
    fontWeight: 'normal',
    color: 'text.tertiary',
  },
  _focus: {
    borderColor: 'focus.ring',
    borderWidth: '1px',
    outline: '2px solid',
    outlineOffset: '2px',
    outlineColor: 'focus.ring',
  },
  _disabled: {
    bgColor: 'surface.subtle',
    borderColor: 'border.subtle',
  },
  _invalid: {
    borderColor: 'status.error.solid',
  },
}
