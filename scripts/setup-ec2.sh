#!/usr/bin/env bash
set -e

echo "=== 1. Configuring 2GB Swap Memory ==="
if [ ! -f /swapfile ]; then
    sudo dd if=/dev/zero of=/swapfile bs=128M count=16
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile swap swap defaults 0 0' | sudo tee -a /etc/fstab
fi

echo "=== 2. Detecting OS and Installing Packages ==="
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
fi

if [ "$OS" = "amzn" ]; then
    echo "Detected Amazon Linux"
    sudo dnf update -y
    sudo dnf install -y git docker java-17-amazon-corretto wget

    # Setup Jenkins Repo for Amazon Linux / RedHat
    sudo wget -O /etc/yum.repos.d/jenkins.repo https://pkg.jenkins.io/redhat-stable/jenkins.repo
    sudo rpm --import https://pkg.jenkins.io/redhat-stable/jenkins.io-2023.key
    sudo dnf install -y jenkins

    sudo usermod -aG docker ec2-user
elif [ "$OS" = "ubuntu" ] || [ "$OS" = "debian" ]; then
    echo "Detected Ubuntu / Debian"
    sudo apt update && sudo apt upgrade -y
    sudo apt install -y openjdk-17-jdk docker.io git curl

    sudo mkdir -p /etc/apt/keyrings
    curl -fsSL https://pkg.jenkins.io/debian-stable/jenkins.io-2023.key | sudo tee \
      /etc/apt/keyrings/jenkins-keyring.asc > /dev/null
    echo deb [signed-by=/etc/apt/keyrings/jenkins-keyring.asc] \
      https://pkg.jenkins.io/debian-stable binary/ | sudo tee \
      /etc/apt/sources.list.d/jenkins.list > /dev/null
    sudo apt update
    sudo apt install -y jenkins

    sudo usermod -aG docker ubuntu
fi

echo "=== 3. Configuring Permissions & Services ==="
sudo usermod -aG docker jenkins
sudo systemctl enable --now docker
sudo systemctl restart docker
sudo systemctl enable --now jenkins
sudo systemctl restart jenkins

echo "Waiting for Jenkins to generate admin password..."
while [ ! -f /var/lib/jenkins/secrets/initialAdminPassword ]; do
    sleep 2
done

echo "=========================================================="
echo "Setup Complete!"
echo "Jenkins Initial Admin Password:"
sudo cat /var/lib/jenkins/secrets/initialAdminPassword
echo "=========================================================="
