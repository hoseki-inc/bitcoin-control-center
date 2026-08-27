import { Icon, type IconProps, useToken } from '@chakra-ui/react'
import { isNullish } from '@hoseki/packages/lib/util'
import * as React from 'react'

interface CreateIconOptions {
  /**
   * The icon `svg` viewBox
   * @default "0 0 24 24"
   */
  viewBox?: string
  /**
   * The `svg` path or group element
   * @type React.ReactElement | React.ReactElement[]
   */
  path?: React.ReactElement | React.ReactElement[] | ((props: ComponentProps) => React.ReactElement)
  /**
   * If the has a single path, simply copy the path's `d` attribute
   */
  d?: string
  /**
   * The display name useful in the dev tools
   */
  displayName?: string
  /**
   * Default props automatically passed to the component; overwriteable
   */
  defaultProps?: IconProps
}

type ExtraColors = {
  color2?: string
  color3?: string
  color4?: string
}
export type ComponentProps = IconProps & ExtraColors

/**
 * Our version of createIcon from chakra-ui.
 * Useful when we want to apply different combinations of colors to its
 * parts without creating a new icon for every combination.
 *
 * @example
 * ```tsx
 *  const Icon = createIcon({
 *    path: (props) => (
 *      <>
 *        <path fill='currentColor' d="M10 10" />
 *        <path fill={props.color2} d="M10 10" />
 *        <path fill={props.color3} d="M10 10" />
 *        <path fill={props.color4} d="M10 10" />
 *      </>
 *    ),
 *  })
 * ```
 *
 * Usage:
 * ```tsx
 *  <Icon color="red" color2="blue" color3="green" color4="yellow" />
 */
export function createIcon(
  options: CreateIconOptions,
): React.ForwardRefExoticComponent<ComponentProps & React.RefAttributes<SVGSVGElement>> {
  const { viewBox = '0 0 24 24', d: pathDefinition, path, defaultProps } = options

  const Comp = React.forwardRef<SVGSVGElement, ComponentProps>(({ color2, color3, color4, ...props }, ref) => {
    const colors = [color2, color3, color4].filter((v): v is string => !isNullish(v))
    const [color2Resolved, color3Resolved, color4Resolved] = useToken('colors', colors)
    return (
      <Icon ref={ref} viewBox={viewBox} {...defaultProps} {...props}>
        {path ? (
          typeof path === 'function' ? (
            path({ ...props, color2: color2Resolved, color3: color3Resolved, color4: color4Resolved })
          ) : (
            path
          )
        ) : (
          <path fill="currentColor" d={pathDefinition} />
        )}
      </Icon>
    )
  })
  Comp.displayName = options.displayName ?? 'ExtendedIcon'

  return Comp
}
