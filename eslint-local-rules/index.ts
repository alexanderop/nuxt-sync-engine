import composableMustUseVue from './rules/composable-must-use-vue.ts'
import noHardcodedColors from './rules/no-hardcoded-colors.ts'
import noLetInDescribe from './rules/no-let-in-describe.ts'
import extractConditionVariable from './rules/extract-condition-variable.ts'
import repositoryTrycatch from './rules/repository-trycatch.ts'
import noWithDefaults from './rules/no-with-defaults.ts'

export default {
  rules: {
    'composable-must-use-vue': composableMustUseVue,
    'no-hardcoded-colors': noHardcodedColors,
    'no-let-in-describe': noLetInDescribe,
    'extract-condition-variable': extractConditionVariable,
    'repository-trycatch': repositoryTrycatch,
    'no-with-defaults': noWithDefaults,
  },
}
