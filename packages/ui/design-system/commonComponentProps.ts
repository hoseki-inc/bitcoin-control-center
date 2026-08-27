// NOTE: These are put here because they are used by both <Input> and <Textarea>
export const inputProps = {
  border: '1px solid',
  borderColor: 'neutral.200',
  borderRadius: '4px',

  color: 'neutral.600',
  fontSize: '1rem',

  px: '2',
  py: '2',

  outline: 0,
  outlineOffset: 0,

  _placeholder: {
    textStyle: 'text/md',
    fontWeight: 'normal',
    color: 'neutral.400',
  },
  _focus: {
    borderColor: 'neutral.200',
    borderWidth: '1px',
    outlineColor: 'primary.300',
  },
  _disabled: {
    bgColor: 'neutral.50',
    borderColor: 'neutral.50',
  },
  _invalid: {
    borderColor: 'error.500',
  },
}
