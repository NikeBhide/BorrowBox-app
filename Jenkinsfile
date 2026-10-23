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
                '''
            }
        }

        stage('Push to Docker Hub') {
            steps {
                withCredentials([usernamePassword(credentialsId: 'dockerhub-creds',
                                                  usernameVariable: 'DH_USER',
                                                  passwordVariable: 'DH_PASS')]) {
                    sh '''
                        echo "Logging in to Docker Hub..."
                        echo "$DH_PASS" | docker login -u "$DH_USER" --password-stdin
                        docker tag ${APP_NAME}:latest $DH_USER/${APP_NAME}:${BUILD_NUMBER}
                        docker tag ${APP_NAME}:latest $DH_USER/${APP_NAME}:latest
                        docker push $DH_USER/${APP_NAME}:${BUILD_NUMBER}
                        docker push $DH_USER/${APP_NAME}:latest
                    '''
                }
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
