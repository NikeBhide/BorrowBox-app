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
                    echo "Checking tools..."
                    node --version
                    npm --version
                    docker --version
                    kubectl version --client
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

        stage('Build Container') {
            steps {
                sh '''
                    echo "Building Docker image..."
                    docker build -t ${APP_NAME}:latest .
                    echo "Importing image into Kubernetes (k3s)..."
                    docker save ${APP_NAME}:latest | sudo /usr/local/bin/k3s ctr images import -
                '''
            }
        }

        stage('Deploy to Kubernetes') {
            steps {
                sh '''
                    echo "Applying Kubernetes manifests..."
                    kubectl apply -f k8s/

                    echo "Triggering Kubernetes rollout restart..."
                    kubectl rollout restart deployment/borrowbox-deployment

                    echo "Waiting for Kubernetes pod rollout to complete..."
                    kubectl rollout status deployment/borrowbox-deployment --timeout=120s
                '''
            }
        }

        stage('Smoke Test (Health Check)') {
            steps {
                sh '''
                    sleep 3
                    echo "Verifying application health via Kubernetes Service..."
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
            echo "BorrowBox successfully deployed to Kubernetes!"
        }
        failure {
            echo "Pipeline failed. Check build logs above."
        }
    }
}
