import neostandard from 'neostandard'

export default [
  ...neostandard({
    env: ['node']
  }),
  {
    rules: {
      'no-unused-vars': ['error', {
        args: 'none',
        caughtErrors: 'none',
        ignoreRestSiblings: true,
        vars: 'all',
        varsIgnorePattern: '^_'
      }]
    }
  }
]
