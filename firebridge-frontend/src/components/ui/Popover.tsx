import * as Primitive from '@radix-ui/react-popover'
import type { ReactElement, ReactNode } from 'react'

export function Popover({ trigger, children, label }: { trigger: ReactElement; children: ReactNode; label: string }) {
  return <Primitive.Root><Primitive.Trigger asChild>{trigger}</Primitive.Trigger>
    <Primitive.Portal><Primitive.Content className="ui-popover" aria-label={label} sideOffset={8} collisionPadding={12}>
      {children}<Primitive.Close asChild><button type="button" className="ui-button ui-button--secondary">Close date picker</button></Primitive.Close>
    </Primitive.Content></Primitive.Portal>
  </Primitive.Root>
}
