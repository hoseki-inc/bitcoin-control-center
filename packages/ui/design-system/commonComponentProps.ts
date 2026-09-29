// NOTE: These are put here because they are used by both <Input> and <Textarea>
export const inputProps = {
  border: '1px solid',
  borderColor: 'neutral.200',
  borderRadius: 'control',

  color: 'neutral.900',
  textStyle: 'text/md',

  px: '3',
  py: '2',

  outline: 0,
  outlineOffset: 0,

  _placeholder: {
    textStyle: 'text/md',
    fontWeight: 'normal',
    color: 'neutral.500',
  },
  _focus: {
    borderColor: 'activeState.80',
    borderWidth: '1px',
    outline: '2px solid',
    outlineOffset: '2px',
    outlineColor: 'activeState.80',
  },
  _disabled: {
    bgColor: 'neutral.50',
    borderColor: 'neutral.50',
  },
  _invalid: {
    borderColor: 'error.500',
  },
}
