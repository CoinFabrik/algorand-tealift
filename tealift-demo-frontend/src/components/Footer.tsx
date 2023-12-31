import { Box, Heading, Highlight } from '@chakra-ui/react'

const Footer = (): JSX.Element => {
  return (
    <Box marginTop={0} marginBottom={0} flex={1} bottom={0} textAlign='center'>
    <Heading lineHeight='tall' size='sm'>
      <Highlight
        query='Coinfabrik'
        styles={{ px: '2', py: '1', rounded: 'full', bg: 'blue.100' }}
      >
        done with ❤️ by Coinfabrik
      </Highlight>
    </Heading>
  </Box>
  )
}

export default Footer
