import * as Primitive from '@radix-ui/react-tooltip'
import type { ReactElement, ReactNode } from 'react'

export function Tooltip({ children, content }: { children: ReactElement; content: ReactNode }) {
  return <Primitive.Provider delayDuration={300}><Primitive.Root>
    <Primitive.Trigger asChild>{children}</Primitive.Trigger><Primitive.Portal>
      <Primitive.Content className="ui-tooltip" sideOffset={8} collisionPadding={12}>
        {content}<Primitive.Arrow className="ui-tooltip-arrow" />
      </Primitive.Content>
    </Primitive.Portal>
  </Primitive.Root></Primitive.Provider>
}
