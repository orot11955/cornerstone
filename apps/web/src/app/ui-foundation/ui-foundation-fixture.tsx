'use client'

import {
  AspectRatio,
  Box,
  Button,
  Container,
  Grid,
  Heading,
  Input,
  ScrollArea,
  Spinner,
  Stack,
  Text,
} from '@cornerstone/ui'
import { Dialog } from '@cornerstone/ui/browser'
import { useRef, useState } from 'react'

const longTranslation =
  '설정이 모든 화면 크기와 입력 방식에서 정보와 포커스 순서를 잃지 않는지 확인하는 매우 긴 번역 예시입니다.'

export function UiFoundationFixture() {
  const initialFocusRef = useRef<HTMLInputElement>(null)
  const [dialogChanges, setDialogChanges] = useState(0)

  return (
    <main>
      <Container
        data-testid="safe-area-layout"
        size="xl"
        gutter={{ base: '3', md: '6' }}
        style={{
          minBlockSize: '100svh',
          paddingBlockEnd: 'max(0.75rem, env(safe-area-inset-bottom))',
        }}
      >
        <Stack gap="6">
          <header>
            <Heading as="h1" size="xl">
              Cornerstone UI Foundation
            </Heading>
            <Text tone="muted">Theme · Style · Brand · Density 독립 축과 반응형 레이아웃</Text>
          </header>

          <Grid columns={{ base: 1, md: 3 }} gap="4">
            <Box padding="4">
              <Text>Viewport responsive</Text>
            </Box>
            <AspectRatio ratio="16 / 9">
              <Box padding="4">Aspect ratio</Box>
            </AspectRatio>
            <ScrollArea axis="inline">
              <Text>{longTranslation.repeat(2)}</Text>
            </ScrollArea>
          </Grid>

          {[280, 480, 720, 960].map((width) => (
            <Container
              key={width}
              data-testid={`container-${width}`}
              containerQuery
              size="full"
              gutter="0"
              style={{ inlineSize: `${width}px`, maxInlineSize: '100%' }}
            >
              <Grid
                data-testid={`container-grid-${width}`}
                containerColumns={{ base: 1, narrow: 2, regular: 3, wide: 4 }}
                gap="2"
              >
                <Box padding="2">One</Box>
                <Box padding="2">Two</Box>
                <Box padding="2">Three</Box>
                <Box padding="2">Four</Box>
              </Grid>
            </Container>
          ))}

          <section dir="rtl" lang="ar" data-testid="rtl-fixture">
            <Heading as="h2">واجهة من اليمين إلى اليسار</Heading>
            <Text>{longTranslation}</Text>
          </section>

          <Dialog.Root onOpenChange={() => setDialogChanges((value) => value + 1)}>
            <Dialog.Trigger data-testid="dialog-trigger">환경 설정 열기</Dialog.Trigger>
            <Dialog.Content
              id="settings-dialog"
              initialFocusRef={initialFocusRef}
              data-testid="settings-dialog"
            >
              <Dialog.Title id="settings-dialog-title">환경 설정</Dialog.Title>
              <Dialog.Description id="settings-dialog-description">
                사용자 인터페이스 환경을 확인합니다.
              </Dialog.Description>
              <Input ref={initialFocusRef} data-testid="dialog-input" aria-label="표시 이름" />
              <Dialog.Close data-testid="dialog-close">닫기</Dialog.Close>
            </Dialog.Content>
          </Dialog.Root>
          <output data-testid="dialog-changes">{dialogChanges}</output>

          <Button loading>저장 중</Button>
          <Spinner label="불러오는 중" />
        </Stack>
      </Container>
    </main>
  )
}
