import { useId, useState } from 'react'
import { Button, IconPlusOutlineRegular, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ScheduleCreation.module.css'

/** Conversation preparation without message submission or task creation. */
export interface ScheduleCreationInjected {
  /**
   * Open a conversation with an unsent request, preserving any existing draft.
   * @param prompt - localized request containing the user's instruction and schedule.
   */
  readonly onContinue: (prompt: string) => void
}

/** Creation slot inputs with localized guidance and conversation navigation. */
export type ScheduleCreationProps = PropsRuntime<'schedule.manager.creation'>
  & PropsLocale<'dobee.schedule.creation'>
  & InjectFace<ScheduleCreationInjected>

/**
 * Collect the instruction and timing before preparing an unsent request.
 * @param props - placement, localized copy, and draft navigation.
 * @returns the creation entry and its dismissable guide.
 */
export function ScheduleCreation({ placement, onContinue, t }: Pick<ScheduleCreationProps, 'placement' | 'onContinue' | 't'>) {
  const [open, setOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [timing, setTiming] = useState('')
  const id = useId()
  const ready = instruction.trim() !== '' && timing.trim() !== ''
  return (
    <div className={placement === 'empty' ? css.empty : css.entry}>
      {placement === 'empty' && <p className={css.hint}>{t('emptyHint')}</p>}
      <Button
        variant={placement === 'header' ? 'primary' : 'outline'}
        size={placement === 'header' ? 'sm' : 'md'}
        icon={<IconPlusOutlineRegular size={13} />}
        onClick={() => { setOpen(true) }}
      >{t('action')}</Button>
      <Modal
        open={open}
        onClose={() => { setOpen(false) }}
        title={t('title')}
        closeLabel={t('close')}
        description={t('description')}
        className={css.dialog as string}
        contentClassName={css.content as string}
        footer={<>
          <Button variant="outline" onClick={() => { setOpen(false) }}>{t('cancel')}</Button>
          <Button variant="primary" disabled={!ready} onClick={() => {
            onContinue(t('draft', { instruction: instruction.trim(), timing: timing.trim() }))
            setOpen(false)
          }}>{t('next')}</Button>
        </>}
      >
        <div className={css.form}>
          <label className={css.field} htmlFor={`${id}-instruction`}>
            <span>{t('instruction')}</span>
            <Input
              id={`${id}-instruction`}
              data-modal-autofocus
              required
              value={instruction}
              placeholder={t('instructionPlaceholder')}
              onChange={(event) => { setInstruction(event.target.value) }}
            />
          </label>
          <label className={css.field} htmlFor={`${id}-timing`}>
            <span>{t('timing')}</span>
            <Input
              id={`${id}-timing`}
              required
              value={timing}
              aria-describedby={`${id}-timing-hint`}
              placeholder={t('timingPlaceholder')}
              onChange={(event) => { setTiming(event.target.value) }}
            />
          </label>
          <p className={css.hint} id={`${id}-timing-hint`}>{t('timingHint')}</p>
          <p className={css.hint}>{t('confirmation')}</p>
          <p className={css.hint}>{t('management')}</p>
        </div>
      </Modal>
    </div>
  )
}
