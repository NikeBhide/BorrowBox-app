   pipeline {
     agent any
     tools { nodejs 'node20' }
     stages {
       stage('Install') { steps { sh 'npm ci' } }
       stage('Test')    { steps { sh 'npm test' } }
       stage('Deploy')  {
         steps { sh 'curl -X POST "$RENDER_DEPLOY_HOOK"' }
       }
     }
   }
