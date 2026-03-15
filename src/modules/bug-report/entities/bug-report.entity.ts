import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('bug_report')
export class BugReport {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'varchar', length: 100 })
    name: string;

    @Column({ type: 'varchar', length: 100 })
    email: string;

    @Column({ type: 'longtext', nullable: true })
    description: string;

    @Column({ type: 'longtext', nullable: true })
    steps: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    broswer_device: string;

    @Column({ type: 'longtext', nullable: true })
    screenshot_url: string;

    @CreateDateColumn({ type: 'timestamp', nullable: true, default: () => 'CURRENT_TIMESTAMP' })
    created_at: Date;
}
