pipeline {
    agent any

    environment {
        APP_NAME = 'borrowbox'
        PORT     = '3000'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Environment Check') {
            steps {
                sh '''
                    echo "Checking system tools..."
                    node --version
                    npm --version
                    docker --version
                '''
            }
        }

        stage('Install Dependencies') {
            steps {
                sh 'npm ci'
            }
        }

        stage('Run Tests') {
            steps {
                sh 'npm test'
            }
        }

        stage('Build Docker Image') {
            steps {
                sh "docker build -t ${APP_NAME}:latest ."
            }
        }

        stage('Deploy Container') {
            steps {
                sh '''
                    # Stop & remove old container if it exists
                    docker stop ${APP_NAME} || true
                    docker rm ${APP_NAME} || true

                    # Start new container
                    docker run -d \
                        --name ${APP_NAME} \
                        --restart unless-stopped \
                        -p ${PORT}:3000 \
                        ${APP_NAME}:latest
                '''
            }
        }

        stage('Smoke Test (Health Check)') {
            steps {
                sh '''
                    # Give Express 5 seconds to boot
                    sleep 5
                    # Verify HTTP 200 response from /health route
                    curl -f http://localhost:${PORT}/health
                '''
            }
        }
    }

    post {
        always {
            cleanWs()
        }
        success {
            echo "BorrowBox successfully deployed! Available at http://localhost:${PORT}"
        }
        failure {
            echo "Pipeline failed. Check build logs above."
        }
    }
}
