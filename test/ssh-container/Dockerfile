FROM alpine:3.22
RUN apk add --no-cache openssh-server tmux \
    && mkdir -p /root/.ssh /run/sshd \
    && chmod 700 /root/.ssh \
    && passwd -d root \
    && printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\nPrintMotd no\n' > /etc/ssh/sshd_config.d/jelly-test.conf
CMD ["sh", "-c", "ssh-keygen -A && exec /usr/sbin/sshd -D -e"]
