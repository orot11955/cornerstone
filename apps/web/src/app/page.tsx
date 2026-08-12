import { connection } from 'next/server'
import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Container,
  FormField,
  Grid,
  Heading,
  Inline,
  Input,
  Panel,
  Select,
  Stack,
  Switch,
  Text,
} from '@cornerstone/ui'

export default async function Home() {
  await connection()
  return (
    <main>
      <Container size="xl" gutter={{ base: '4', md: '8' }}>
        <Box padding={{ base: '6', md: '10', xl: '12' }}>
          <Stack gap={{ base: '8', lg: '12' }}>
            <Stack gap="4">
              <Inline gap="2">
                <Badge tone="brand">Cornerstone</Badge>
                <Badge tone="success" variant="outline">
                  Foundation Preview
                </Badge>
              </Inline>
              <Heading as="h1" size="xl">
                프로젝트의 기반을 직접 조합하세요
              </Heading>
              <Text as="p" size="lg" tone="muted">
                Theme, Style, Brand와 Density를 독립적으로 선택하고 같은 component API로 새로운
                제품을 시작합니다.
              </Text>
            </Stack>

            <Grid columns={{ base: 1, lg: 2 }} gap={{ base: '6', lg: '8' }}>
              <Panel variant="outlined" padding={{ base: '5', md: '6' }}>
                <Stack gap="5">
                  <Stack gap="2">
                    <Heading as="h2" size="lg">
                      초기 프로젝트 설정
                    </Heading>
                    <Text as="p" tone="muted">
                      선택값은 secret이 없는 capability manifest로 저장됩니다.
                    </Text>
                  </Stack>

                  <FormField
                    label="프로젝트 이름"
                    description="소문자, 숫자와 하이픈을 사용할 수 있습니다."
                    required
                  >
                    {(props) => (
                      <Input
                        {...props}
                        name="name"
                        defaultValue="atlas-console"
                        autoComplete="off"
                      />
                    )}
                  </FormField>

                  <FormField label="Profile" required>
                    {(props) => (
                      <Select {...props} name="profile" defaultValue="standard">
                        <option value="minimal">Minimal</option>
                        <option value="standard">Standard</option>
                        <option value="production">Production</option>
                        <option value="regulated">Regulated</option>
                      </Select>
                    )}
                  </FormField>

                  <Checkbox
                    name="examples"
                    label="Reference 화면 포함"
                    description="인증, 설정, CRUD와 Dashboard 예제를 생성합니다."
                  />
                  <Switch
                    name="dark"
                    label="Dark Theme"
                    description="초기 SSR Appearance에 반영합니다."
                    defaultChecked
                  />

                  <Inline justify="between" gap="3">
                    <Button variant="ghost" tone="neutral">
                      Manifest 보기
                    </Button>
                    <Button>프로젝트 계획 생성</Button>
                  </Inline>
                </Stack>
              </Panel>

              <Stack gap="5">
                <Alert tone="info" title="현재 Reference 조합">
                  dark + industrial + signal-violet + default
                </Alert>
                <Panel variant="elevated" padding={{ base: '5', md: '6' }}>
                  <Stack gap="4">
                    <Heading as="h2" size="md">
                      독립 Appearance 축
                    </Heading>
                    <Grid columns={{ base: 2, md: 4 }} gap="3">
                      {[
                        ['Theme', 'Dark'],
                        ['Style', 'Industrial'],
                        ['Brand', 'Signal Violet'],
                        ['Density', 'Default'],
                      ].map(([label, value]) => (
                        <Stack key={label} gap="1">
                          <Text size="sm" tone="muted">
                            {label}
                          </Text>
                          <Text weight="semibold">{value}</Text>
                        </Stack>
                      ))}
                    </Grid>
                  </Stack>
                </Panel>
              </Stack>
            </Grid>
          </Stack>
        </Box>
      </Container>
    </main>
  )
}
